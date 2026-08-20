/**
 * The schema for this repository. It runs in two places from this same file: in
 * the CI here, on every PR, purely to validate; and in the Vercel build, to
 * generate the data the site consumes. One schema, in one place — which is the
 * reason it lives next to the content (ADR-0001).
 *
 * The `--strict` flag on the command line is mandatory. Without it Velite drops
 * the invalid item with a warning in the log and exits green, which means a text
 * vanishing from the site with nobody noticing.
 */
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import rehypeShiki, { type RehypeShikiOptions } from "@shikijs/rehype";
import { createCssVariablesTheme } from "shiki";
import {
  context,
  defineCollection,
  defineConfig,
  getImageMetadata,
  s,
  type Image,
  type MarkdownOptions,
} from "velite";
import {
  DEFAULT_LOCALE,
  LOCALES,
  STACK,
  STACK_LABELS,
  TAG_LABELS,
  TAGS,
  type Locale,
} from "./taxonomy";

/* ---------------------------------------------------------------------------
   IDENTITY — `<type>/<key>/<locale>.mdx`

   The folder is the item's identity and never appears in a URL; the file name is
   the language; the `slug` in the frontmatter is the public URL, different per
   language. Identity and language are derived from the path rather than typed: a
   typed field can drift between two files, a folder cannot.
   --------------------------------------------------------------------------- */

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

interface Identity {
  locale: Locale;
  translationKey: string;
}

const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Returns the identity, or the error message that fails the file. */
const readIdentity = (): Identity | string => {
  const { file } = context();
  const stem = file.stem;
  const dir = file.dirname;
  if (stem == null || dir == null) return `unexpected path: '${file.path}'`;
  if (!isLocale(stem)) {
    const expected = LOCALES.map((locale) => `${locale}.mdx`).join(" or ");
    return `'${stem}.mdx' is not a language — the file must be named ${expected}`;
  }
  const translationKey = basename(dir);
  if (!KEY_RE.test(translationKey)) {
    return `the folder '${translationKey}' is not a valid key (lowercase, digits and single hyphens)`;
  }
  return { locale: stem, translationKey };
};

/* ---------------------------------------------------------------------------
   BULLET BODY (experience)

   The ADR says "body: the achievements as bullets". Rather than compiling to
   HTML and having the site scrape <li>, the achievements come out as string[] —
   the panel styles each bullet, and structured CV data comes for free later.

   The mdast is populated even without `s.markdown()` on the collection (verified
   on Velite 0.4.0). The local typing avoids pulling in @types/mdast just for it.
   --------------------------------------------------------------------------- */

interface MdNode {
  type: string;
  value?: string;
  alt?: string | null;
  url?: string;
  children?: MdNode[];
  /** `hProperties` is how mdast hands attributes to the HTML it becomes. */
  data?: { hProperties?: Record<string, unknown> };
}

const plainText = (node: MdNode): string =>
  node.value ?? (node.children ?? []).map(plainText).join("");

interface Bullets {
  highlights: string[];
  /** Top-level blocks that are not lists — text that would be dropped silently. */
  stray: number;
}

const readBullets = (): Bullets => {
  const root = context().file.mdast as unknown as MdNode | undefined;
  const top = root?.children ?? [];
  const highlights = top
    .filter((node) => node.type === "list")
    .flatMap((list) => list.children ?? [])
    .map((item) => plainText(item).trim())
    .filter((text) => text.length > 0);
  return {
    highlights,
    stray: top.filter((node) => node.type !== "list").length,
  };
};

/**
 * Body images without alt text. Accessibility is an acceptance criterion in the
 * site's contract, and an image without alt can only be caught here — once it
 * becomes HTML, nobody looks again.
 */
const imagesWithoutAlt = (): string[] => {
  const walk = (node: MdNode): string[] => {
    const here =
      node.type === "image" && (node.alt ?? "").trim().length === 0
        ? [node.url ?? "(sem url)"]
        : [];
    return [...here, ...(node.children ?? []).flatMap(walk)];
  };
  const root = context().file.mdast as unknown as MdNode | undefined;
  return root == null ? [] : walk(root);
};

/* ---------------------------------------------------------------------------
   IMAGES ON THE CDN

   Images are not committed here. They live in the bucket behind `assetsBaseUrl`
   (site.yml), keyed by the structure this repository already has, minus the
   `img/` segment the reference carries:

     work/populatte/en.mdx  +  ./img/landing-hero.png
       →  <assetsBaseUrl>/work/populatte/landing-hero.png

   The reference in the text stays RELATIVE on purpose: no `.mdx` file ever
   carries the CDN's hostname, so moving the images is one line in site.yml,
   not an edit in every text. The build resolves each reference, downloads the
   file once, and fails loudly when the CDN does not have it — the same
   missing-image guarantee the repository had while the files lived here.

   Downloading is not only validation. `width`/`height` (and the cover's blur
   placeholder) come out of the bytes, and nothing else can measure them once
   the files are not in the checkout. The price is that the build now needs
   the network — accepted: it runs in CI and on Vercel, which always have it,
   and a CDN outage turns into a red build, never into a broken page.
   --------------------------------------------------------------------------- */

/** `<root>/<type>/<key>/<locale>.mdx` — the two folders above the file. */
const itemPath = (
  mdxPath: string,
): { root: string; type: string; key: string } => {
  const keyDir = dirname(mdxPath);
  const typeDir = dirname(keyDir);
  return { root: dirname(typeDir), type: basename(typeDir), key: basename(keyDir) };
};

/**
 * `assetsBaseUrl` read straight from site.yml with a pattern, not a YAML
 * parser: this config is compiled and run by whichever repository invokes it
 * (this one and the site), and a YAML library would have to be a dependency of
 * both. The pattern accepts exactly the shape the site collection's schema
 * enforces — double quotes, https, no trailing slash — plus the two things an
 * editor adds without asking, a trailing comment and a CR; anything else
 * fails loudly right here rather than parsing differently in the two places.
 */
const ASSETS_BASE_RE =
  /^assetsBaseUrl:[ \t]*"(https:\/\/[^"\s]*[^"\s/])"[ \t]*(?:#.*)?\r?$/m;

/**
 * Read per call, not memoized: site.yml is a few hundred bytes and a build
 * reads it a couple dozen times, while `velite dev` must see an edit on the
 * next rebuild instead of serving whatever value the process started with.
 */
const assetsBaseUrl = async (root: string): Promise<string> => {
  const text = await readFile(resolve(root, "site.yml"), "utf8");
  const match = ASSETS_BASE_RE.exec(text);
  if (match == null) {
    throw new Error(
      `site.yml needs assetsBaseUrl: "https://…" — double quotes, no trailing slash; every image resolves against it`,
    );
  }
  return match[1];
};

/**
 * What a reference may look like: one `img/` folder, one file name, and only
 * characters that survive being pasted into a URL verbatim — the bucket key
 * must match the reference byte for byte.
 */
const IMG_REF_RE = /^\.\/img\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

const REF_HELP =
  "an image is referenced as ./img/<file> (letters, digits, dot, hyphen, underscore) and served from the CDN — see the README";

/** The public URL a reference resolves to, or null when it is not a reference. */
const imageUrl = async (
  mdxPath: string,
  ref: string,
): Promise<string | null> => {
  const name = IMG_REF_RE.exec(ref)?.[1];
  if (name == null) return null;
  const { root, type, key } = itemPath(mdxPath);
  return `${await assetsBaseUrl(root)}/${type}/${key}/${name}`;
};

/** Everything `getImageMetadata` measures: dimensions plus the blur fields. */
type RemoteImage = Omit<Image, "src">;

/**
 * The whole chain of an error, not just its head: `fetch` buries the part
 * worth reading — ENOTFOUND, ECONNRESET, a TLS complaint — in `cause`, and
 * reporting only the head prints "fetch failed" twelve times for a typo in
 * the hostname.
 */
const describeError = (error: unknown): string => {
  const parts: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    parts.push(current.message);
  }
  return parts.length > 0 ? parts.join(" — ") : String(error);
};

const FETCH_ATTEMPTS = 3;

/** Per attempt, and covering the body too — a CDN that goes mute mid-download
 *  must become a diagnosable failure, not a build that hangs into CI's cap. */
const FETCH_TIMEOUT_MS = 30_000;

/** The 4xx that mean "not now" rather than "not there". */
const RETRIABLE_STATUS = new Set([408, 429]);

/**
 * GET rather than HEAD, because the bytes are the point. A 4xx is a file that
 * was never uploaded and retrying cannot fix it — except 408 and 429, which
 * are the CDN pushing back and join 5xx and network errors in getting two
 * more tries, with backoff so the retry is not the same second the CDN just
 * refused. Reading the body lives inside the `try` on purpose: a connection
 * dropped mid-download is as retriable as one never opened.
 */
const fetchImage = async (url: string): Promise<Buffer> => {
  let failure = "";
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await new Promise((done) => setTimeout(done, 500 * 2 ** (attempt - 1)));
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = `the CDN answered ${response.status}`;
      if (response.status < 500 && !RETRIABLE_STATUS.has(response.status)) {
        break;
      }
    } catch (error) {
      failure = describeError(error);
    }
  }
  throw new Error(failure);
};

/**
 * One download per URL per process, shared by the languages of an item and by
 * the cover. The failure is cached too — in `velite dev`, a file uploaded
 * after the first miss needs a restart to be seen.
 */
const measured = new Map<string, Promise<RemoteImage>>();

const measureImage = (url: string): Promise<RemoteImage> => {
  let pending = measured.get(url);
  if (pending == null) {
    pending = fetchImage(url).then(async (bytes) => {
      const metadata = await getImageMetadata(bytes);
      if (metadata == null) throw new Error("the file is not a measurable image");
      return metadata;
    });
    measured.set(url, pending);
  }
  return pending;
};

/* ---------------------------------------------------------------------------
   THE BODY PIPELINE

   Three things the body needs that Velite does not do on its own, all handed to
   every `s.markdown()` through `markdownOptions`. None of them decides how
   anything looks: one swaps every image reference for its CDN URL and adds
   dimensions, one adds an anchor to every section, and the last adds classes
   and CSS variable names. The site owns the appearance (ADR-0001).
   --------------------------------------------------------------------------- */

/**
 * Rewrites every body image to its CDN URL and writes `width` and `height` on
 * it, so the text does not jump when the image finishes loading.
 *
 * It is a REMARK plugin on purpose. Velite pushes its `rehypeCopyLinkedFiles`
 * ahead of any rehype plugin we pass (verified in the 0.4.0 dist), and that
 * plugin treats a relative `src` as a local file to copy — a file this
 * repository no longer has. Here the URL is still `./img/<file>`; by the time
 * rehype runs it is absolute, and `rehypeCopyLinkedFiles` leaves it alone.
 */
const remarkImagesFromCdn =
  () =>
  async (tree: MdNode, file: { path?: string }): Promise<void> => {
    const images: MdNode[] = [];
    const walk = (node: MdNode): void => {
      if (node.type === "image") images.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);

    const path = file.path ?? ".";
    await Promise.all(
      images.map(async (node) => {
        const ref = node.url ?? "";
        const url = await imageUrl(path, ref);
        if (url == null) {
          // Loud rather than silent: an external URL is nobody's here to
          // validate or measure, and a misshapen relative one would ship as a
          // broken image nobody looks at once it is HTML.
          throw new Error(`'${ref}' — ${REF_HELP}`);
        }
        let width: number;
        let height: number;
        try {
          ({ width, height } = await measureImage(url));
        } catch (error) {
          throw new Error(`could not fetch '${url}': ${describeError(error)}`);
        }
        node.url = url;
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, width, height } };
      }),
    );
  };

/** A hast node, typed here for the same reason `MdNode` is: @types/hast is not
 *  a dependency of this repository, and the walk below needs four fields. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * The text of a heading, with the markup dropped: `<code>`, emphasis and a link
 * contribute their words. Only `text` nodes count — in hast a `comment` also
 * carries a `value`, and it is not something anyone reads.
 */
const headingText = (node: HastNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(headingText).join("");

/**
 * Gives every `h2` and `h3` in the body an `id`, so a link can point at a
 * section instead of at the top of the page.
 *
 * The id is derived from the heading's own text — lowercased, NFD with the
 * combining marks dropped, anything outside `a-z0-9` folded to a hyphen — and
 * repeats are numbered in the order they appear. Deriving it is what makes two
 * builds of unchanged content produce the same anchors. Renaming a section does
 * break its old link, and that is the accepted cost: the link lives inside the
 * site and is regenerated by the same build.
 *
 * It derives ALWAYS, even over an `id` written by hand in raw HTML. Two sources
 * for one section's anchor would be two truths about where it lives; the text is
 * the one every reader can already see.
 *
 * It runs BEFORE Shiki. Shiki only ever replaces a `<pre>`, so the two never
 * meet — but after it a fenced block is a few hundred token spans, and this walk
 * would pay for all of them to look for headings that were never in there.
 */
const rehypeHeadingIds =
  () =>
  (tree: HastNode, file: { path?: string }): void => {
    // Per file, not per plugin: a Set in the closure would leak ids from `en.mdx`
    // into `pt.mdx` and make the output depend on the order the files are read.
    const taken = new Set<string>();
    const walk = (node: HastNode): void => {
      if (node.type === "element" && (node.tagName === "h2" || node.tagName === "h3")) {
        const text = headingText(node);
        const base = text
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (base.length === 0) {
          // Loud rather than silent: a heading with no anchor is a search result
          // that can only open at the top of the page, and nobody looks at the
          // HTML again to notice the id is missing.
          throw new Error(
            `the heading '${text.trim()}' in '${file.path ?? "?"}' produces no anchor — it needs at least one letter or digit`,
          );
        }
        let id = base;
        for (let n = 1; taken.has(id); n += 1) id = `${base}-${n}`;
        taken.add(id);
        node.properties = { ...node.properties, id };
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };

/**
 * Highlight at build time, so the site ships no highlighter to the browser.
 *
 * The theme is Shiki's CSS variables theme: every token comes out as
 * `color:var(--shiki-token-…)` and never as a fixed colour. This repository does
 * not pick a palette — it says "keyword", "string", "comment", and the site
 * answers with a colour in each of its two themes.
 *
 * `langs: []` with `lazy` loads a grammar only when a fence asks for it, which
 * also means a language that does not exist fails the build instead of quietly
 * rendering as plain text. A fence with no language at all is still marked up,
 * as `text`, so the site has one shape to style.
 */
const shikiOptions = {
  theme: createCssVariablesTheme({
    name: "css-variables",
    variablePrefix: "--shiki-",
    // No defaults on purpose: a fallback colour here would be a palette.
    variableDefaults: {},
  }),
  langs: [],
  lazy: true,
  defaultLanguage: "text",
  // Shiki replaces the `language-*` class markdown wrote. Putting it back keeps
  // the fence's own word available to whoever renders it.
  addLanguageClass: true,
} satisfies RehypeShikiOptions;

/** What Velite calls a `Pluggable` — a plugin, or a plugin with its options. */
type RehypePlugin = NonNullable<MarkdownOptions["rehypePlugins"]>[number];

const markdownOptions = {
  remarkPlugins: [remarkImagesFromCdn],
  // Velite's .d.ts inlines unified's types instead of importing them, so the
  // `Plugin` @shikijs/rehype exports and the `Pluggable` Velite expects are two
  // identical declarations TypeScript refuses to unify. The cast bridges the two
  // copies and nothing else — the options above are checked against Shiki's own
  // type, one line up.
  rehypePlugins: [
    rehypeHeadingIds,
    [rehypeShiki, shikiOptions] as unknown as RehypePlugin,
  ],
} satisfies MarkdownOptions;

/* ---------------------------------------------------------------------------
   SHARED FIELDS
   --------------------------------------------------------------------------- */

/**
 * The item's cover. The reference is the same `./img/<file>` shape the body
 * uses; the build resolves it against the CDN and returns the URL with
 * dimensions plus the blur placeholder — the exact object `s.image()` used to
 * produce, so the site keeps rendering it without layout shift. `alt` is a
 * separate, required field because an image without alt does not meet the
 * site's accessibility criterion.
 */
const coverField = () =>
  s
    .object({
      src: s.string().regex(IMG_REF_RE, REF_HELP),
      alt: s.string().min(3).max(160),
    })
    .transform(async (data, ctx) => {
      const fail = (message: string) => {
        ctx.addIssue({ code: "custom", message, fatal: true });
        return s.NEVER;
      };
      // Everything async stays behind a catch that turns the problem into THIS
      // file's issue. A rejection escaping a transform aborts the whole build
      // with one line that names no file — and swallows every issue the other
      // files had already collected.
      let url: string | null;
      try {
        url = await imageUrl(context().file.path, data.src);
      } catch (error) {
        return fail(`cover '${data.src}': ${describeError(error)}`);
      }
      if (url == null) {
        // Unreachable behind the regex above; TypeScript cannot know that.
        return fail(REF_HELP);
      }
      try {
        return { src: { src: url, ...(await measureImage(url)) }, alt: data.alt };
      } catch (error) {
        return fail(`could not fetch '${url}': ${describeError(error)}`);
      }
    })
    .optional();

/**
 * The slug does not use `s.slug()`. Its uniqueness is global per scope, and the
 * `en.mdx` and `pt.mdx` of one item may legitimately share a slug — a proper
 * noun does not translate. The uniqueness we want is per language, and the group
 * of `s.slug()` is fixed when the schema is built, with no access to the file.
 * Format here, uniqueness in `prepare`, which sees every document with its
 * locale already derived.
 */
const slugField = () =>
  s
    .string()
    .min(3)
    .max(80)
    .regex(SLUG_RE, "a slug is lowercase, with words separated by a single hyphen");

const stackField = () =>
  s
    .array(s.enum(STACK))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate item in stack")
    .transform((ids) => ids.map((id) => ({ id, label: STACK_LABELS[id] })));

/** The label comes out in the file's language — subjects translate, technologies do not. */
const tagsField = () =>
  s
    .array(s.enum(TAGS))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate tag")
    .transform((ids, ctx) => {
      const identity = readIdentity();
      if (typeof identity === "string") {
        ctx.addIssue({ code: "custom", message: identity, fatal: true });
        return s.NEVER;
      }
      return ids.map((id) => ({ id, label: TAG_LABELS[id][identity.locale] }));
    });

/* ---------------------------------------------------------------------------
   COLLECTIONS
   --------------------------------------------------------------------------- */

/** A post that cites this project. Computed in `prepare`, never written. */
interface RelatedPost {
  translationKey: string;
  locale: Locale;
  slug: string;
  title: string;
  date: string;
}

const experience = defineCollection({
  name: "Experience",
  // The pattern is deliberately wide: `es.mdx` must FAIL with a message rather
  // than vanish silently by not matching the glob.
  pattern: "experience/*/*.mdx",
  schema: s
    .object({
      company: s.string().min(2).max(60),
      role: s.string().min(2).max(80),
      /** "Remote", "Curitiba, Brazil". The panel's "· remote" is UI chrome. */
      location: s.string().min(2).max(60),
      /** One line about the work. Leave the location out — it is already a field. */
      note: s.string().min(10).max(120),
      startDate: s.string().regex(MONTH_RE, "use YYYY-MM"),
      /** Absent means current role. There is no `current` field in the frontmatter. */
      endDate: s.string().regex(MONTH_RE, "use YYYY-MM").optional(),
      stack: stackField(),
    })
    .transform((data, ctx) => {
      const identity = readIdentity();
      if (typeof identity === "string") {
        ctx.addIssue({ code: "custom", message: identity, fatal: true });
        return s.NEVER;
      }
      if (data.endDate != null && data.endDate < data.startDate) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `endDate '${data.endDate}' comes before startDate '${data.startDate}'`,
        });
        return s.NEVER;
      }
      const { highlights, stray } = readBullets();
      if (highlights.length < 3) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `the body needs at least 3 bullets, it has ${highlights.length}`,
        });
        return s.NEVER;
      }
      if (stray > 0) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `the body only accepts bullets — ${stray} block(s) outside a list would be dropped`,
        });
        return s.NEVER;
      }
      return {
        ...data,
        locale: identity.locale,
        translationKey: identity.translationKey,
        current: data.endDate == null,
        highlights,
      };
    }),
});

const work = defineCollection({
  name: "Work",
  pattern: "work/*/*.mdx",
  schema: s
    .object({
      title: s.string().min(2).max(60),
      /** Short, under the H1 of the case-study page. */
      subtitle: s.string().min(4).max(60),
      /** The sentence on the home card. */
      headline: s.string().min(20).max(220),
      slug: slugField(),
      /**
       * Decides the card's footer label. It stores the STATE, not the word:
       * "case study" is UI chrome, translated, and lives in the site.
       */
      kind: s.enum(["case-study", "overview"]),
      /** The card's status. The text translates; the tone does not. */
      status: s.object({
        text: s.string().min(3).max(40),
        tone: s.enum(["live", "idle"]),
      }),
      order: s.number().int().min(1),
      /** Controls appearing on the home page. `false` still has a page and a URL. */
      featured: s.boolean(),
      tags: tagsField(),
      stack: stackField(),
      links: s
        .object({
          repo: s.string().url().optional(),
          live: s.string().url().optional(),
        })
        .default({}),
      /** Stored and never displayed: feeds the sitemap's `lastmod`. */
      updatedAt: s.isodate(),
      cover: coverField(),
      content: s.markdown(markdownOptions),
      /**
       * Derived, nobody fills it in. The case-study page shows reading time in
       * the meta line — it is the only cost signal there, because `updatedAt`
       * is deliberately never displayed.
       */
      metadata: s.metadata(),
    })
    .transform((data, ctx) => {
      const identity = readIdentity();
      if (typeof identity === "string") {
        ctx.addIssue({ code: "custom", message: identity, fatal: true });
        return s.NEVER;
      }
      const noAlt = imagesWithoutAlt();
      if (noAlt.length > 0) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `image without alt text in the body: ${noAlt.join(", ")}`,
        });
        return s.NEVER;
      }
      return {
        ...data,
        locale: identity.locale,
        translationKey: identity.translationKey,
        // Filled in `prepare`. Declared here so the generated type has the field.
        relatedPosts: [] as RelatedPost[],
      };
    }),
});

const log = defineCollection({
  name: "Post",
  pattern: "log/*/*.mdx",
  schema: s
    .object({
      title: s.string().min(6).max(90),
      description: s.string().min(40).max(200),
      slug: slugField(),
      date: s.isodate(),
      tags: tagsField(),
      /** Folder keys from `work/`. Existence is checked in `prepare`. */
      relatedWork: s.array(s.string().regex(KEY_RE)).default([]),
      cover: coverField(),
      content: s.markdown(markdownOptions),
      metadata: s.metadata(),
    })
    .transform((data, ctx) => {
      const identity = readIdentity();
      if (typeof identity === "string") {
        ctx.addIssue({ code: "custom", message: identity, fatal: true });
        return s.NEVER;
      }
      const noAlt = imagesWithoutAlt();
      if (noAlt.length > 0) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `image without alt text in the body: ${noAlt.join(", ")}`,
        });
        return s.NEVER;
      }
      return {
        ...data,
        locale: identity.locale,
        translationKey: identity.translationKey,
      };
    }),
});

const site = defineCollection({
  name: "Site",
  pattern: "site.yml",
  single: true,
  schema: s.object({
    /**
     * The PDF is hosted OUTSIDE this repository: here is public and Git history
     * is permanent, so any older version of the CV — with whatever personal data
     * it carries — would stay traceable forever. Only the link lives here.
     */
    resumeUrl: s.string().url().startsWith("https://"),
    /**
     * Where the images live, for the same reason the CV does: binaries in a
     * public, permanent history stay traceable forever. The bucket behind this
     * URL mirrors the repository's structure minus the `img/` segment —
     * `<assetsBaseUrl>/<type>/<key>/<file>` — and the build joins the pieces
     * with `/`, which is why a trailing slash is rejected.
     */
    assetsBaseUrl: s
      .string()
      .url()
      .startsWith("https://")
      .regex(/[^/]$/, "no trailing slash — the build appends /<type>/<key>/<file>"),
  }),
});

/* ---------------------------------------------------------------------------
   INVARIANTS THAT CROSS FILES

   They all live in `prepare` rather than being scattered across `superRefine`,
   for three reasons: it is the only place that sees every collection at once; it
   reports ALL violations in a single report instead of dying on the first; and
   it does not depend on `config.cache`, which Velite itself marks as deprecated
   for 1.0.

   The CLI prints only `err.message` when this throws — which is why the message
   carries the path of every offending file.
   --------------------------------------------------------------------------- */

interface Localized {
  locale: Locale;
  translationKey: string;
}

const groupByKey = <T extends Localized>(
  docs: readonly T[],
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const doc of docs) {
    const group = groups.get(doc.translationKey);
    if (group) group.push(doc);
    else groups.set(doc.translationKey, [doc]);
  }
  return groups;
};

export default defineConfig({
  // The content is the root. Velite's default ('content') is relative to THIS
  // file and would point at a folder that does not exist.
  root: ".",

  // Inert in practice: the CLI defines `strict` with a `false` default, and the
  // resolver does `options.strict ?? loadedConfig.strict`, so the command line
  // always wins. It stays written because it is the intent, and because it
  // protects `build()` called through the API. What actually enforces it is the
  // `--strict` in the script.
  strict: true,

  output: {
    // Everything stays INSIDE the checkout, relative to this file. With the
    // images on the CDN nothing lands in `assets` any more; the entry stays
    // because the option needs a value, and because anything Velite ever does
    // write must land inside this repository, never outside it — pointing at
    // the site's `public/` would leak into the runner's parent directory in CI
    // and litter the folder containing the clone locally.
    data: ".velite",
    assets: ".velite/static",
    base: "/static/",
    // NEVER turn on: `clean` does rm -rf on `output.assets`.
    clean: false,
  },

  collections: { experience, work, log, site },

  prepare: (data) => {
    const problems: string[] = [];
    const at = (kind: string, key: string, locale?: string) =>
      `${kind}/${key}${locale == null ? "" : `/${locale}.mdx`}`;

    // 1. English required, Portuguese optional (ADR-0002).
    const collections: ReadonlyArray<[string, readonly Localized[]]> = [
      ["experience", data.experience],
      ["work", data.work],
      ["log", data.log],
    ];
    for (const [kind, docs] of collections) {
      for (const [key, group] of groupByKey(docs)) {
        if (!group.some((doc) => doc.locale === DEFAULT_LOCALE)) {
          problems.push(
            `${at(kind, key)}: missing ${DEFAULT_LOCALE}.mdx — English is required`,
          );
        }
      }
    }

    // 2. Slug unique PER LANGUAGE. A global check would reject `en` and `pt`
    //    sharing the slug of a proper noun, which is legitimate.
    const routed: ReadonlyArray<
      [string, ReadonlyArray<Localized & { slug: string }>]
    > = [
      ["work", data.work],
      ["log", data.log],
    ];
    for (const [kind, docs] of routed) {
      const seen = new Map<string, string>();
      for (const doc of docs) {
        const scope = `${doc.locale}:${doc.slug}`;
        const first = seen.get(scope);
        if (first != null) {
          problems.push(
            `${at(kind, doc.translationKey, doc.locale)}: slug '${doc.slug}' already used by ${first} in the same language`,
          );
          continue;
        }
        seen.set(scope, at(kind, doc.translationKey, doc.locale));
      }
    }

    // 3. What is not text must not diverge between the languages of one item —
    //    otherwise the home page would show different cards per language.
    for (const [key, group] of groupByKey(data.work)) {
      const fingerprint = (doc: (typeof data.work)[number]) =>
        JSON.stringify({
          kind: doc.kind,
          order: doc.order,
          featured: doc.featured,
          updatedAt: doc.updatedAt,
          tone: doc.status.tone,
          tags: doc.tags.map((tag) => tag.id),
          stack: doc.stack.map((item) => item.id),
          links: doc.links,
          // The PRESENCE of the cover, not the file: `alt` translates, but one
          // language with a cover and the other without renders different cards.
          hasCover: doc.cover != null,
        });
      const base = group.find((doc) => doc.locale === DEFAULT_LOCALE);
      if (base == null) continue;
      for (const doc of group) {
        if (
          doc.locale !== DEFAULT_LOCALE &&
          fingerprint(doc) !== fingerprint(base)
        ) {
          problems.push(
            `${at("work", key, doc.locale)}: diverges from ${DEFAULT_LOCALE}.mdx in kind/order/featured/updatedAt/status.tone/tags/stack/links or in whether a cover is present`,
          );
        }
      }
    }
    for (const [key, group] of groupByKey(data.log)) {
      const fingerprint = (doc: (typeof data.log)[number]) =>
        JSON.stringify({
          date: doc.date,
          tags: doc.tags.map((tag) => tag.id),
          relatedWork: [...doc.relatedWork].sort(),
        });
      const base = group.find((doc) => doc.locale === DEFAULT_LOCALE);
      if (base == null) continue;
      for (const doc of group) {
        if (
          doc.locale !== DEFAULT_LOCALE &&
          fingerprint(doc) !== fingerprint(base)
        ) {
          problems.push(
            `${at("log", key, doc.locale)}: date/tags/relatedWork diverge from ${DEFAULT_LOCALE}.mdx`,
          );
        }
      }
    }

    // 4. `relatedWork` points at a project that exists.
    const workKeys = new Set(data.work.map((doc) => doc.translationKey));
    for (const post of data.log) {
      for (const key of post.relatedWork) {
        if (!workKeys.has(key)) {
          problems.push(
            `${at("log", post.translationKey, post.locale)}: relatedWork '${key}' does not exist in work/`,
          );
        }
      }
    }

    // 5. At most one current role.
    const current = data.experience.filter(
      (doc) => doc.current && doc.locale === DEFAULT_LOCALE,
    );
    if (current.length > 1) {
      problems.push(
        `experience: ${current.length} roles without endDate (${current
          .map((doc) => doc.translationKey)
          .join(", ")}) — only one can be current`,
      );
    }

    // 6. `order` decides the home showcase; a tie would mean arbitrary order.
    const orders = new Map<number, string>();
    for (const doc of data.work) {
      if (doc.locale !== DEFAULT_LOCALE) continue;
      const first = orders.get(doc.order);
      if (first != null) {
        problems.push(
          `work: order ${doc.order} repeated in ${first} and ${doc.translationKey}`,
        );
        continue;
      }
      orders.set(doc.order, doc.translationKey);
    }

    if (problems.length > 0) {
      throw new Error(
        `\n${problems.length} content problem(s):\n\n  ${problems.join("\n  ")}\n`,
      );
    }

    // 7. Reverse index: "posts about this project". Computed, never written,
    //    and therefore never stale. It lands in the project's language; if the
    //    post does not exist in that language, the English version is used.
    const postsByKey = groupByKey(data.log);
    for (const item of data.work) {
      const related: RelatedPost[] = [];
      for (const [key, versions] of postsByKey) {
        const citesThis = versions.some((post) =>
          post.relatedWork.includes(item.translationKey),
        );
        if (!citesThis) continue;
        const post =
          versions.find((version) => version.locale === item.locale) ??
          versions.find((version) => version.locale === DEFAULT_LOCALE);
        if (post == null) continue;
        related.push({
          translationKey: key,
          locale: post.locale,
          slug: post.slug,
          title: post.title,
          date: post.date,
        });
      }
      item.relatedPosts = related.sort((a, b) => b.date.localeCompare(a.date));
    }

    // 8. Deterministic output order, so the site does not reorder at runtime.
    data.experience.sort((a, b) => b.startDate.localeCompare(a.startDate));
    data.work.sort(
      (a, b) => a.order - b.order || a.locale.localeCompare(b.locale),
    );
    data.log.sort((a, b) => b.date.localeCompare(a.date));
  },
});
