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
  isRelativePath,
  s,
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
   THE BODY PIPELINE

   Two things the body needs that Velite does not do on its own, both handed to
   every `s.markdown()` through `markdownOptions`. Neither of them decides how
   anything looks: one adds dimensions, the other adds classes and CSS variable
   names. The site owns the appearance (ADR-0001).
   --------------------------------------------------------------------------- */

/**
 * Writes `width` and `height` on every body image — the same measurement
 * `s.image()` already does for the cover, applied to the body, so the text does
 * not jump when the image finishes loading.
 *
 * It is a REMARK plugin on purpose. Velite pushes its `rehypeCopyLinkedFiles`
 * ahead of any rehype plugin we pass (verified in the 0.4.0 dist), so by the
 * time rehype runs the URL is already the hashed `/static/...` one and the file
 * on disk would have to be found again. Here the URL is still `./img/foo.png`,
 * relative to the `.mdx` being read. `rehypeCopyLinkedFiles` only rewrites
 * `src`, so the dimensions survive it untouched.
 */
const remarkImageSize =
  () =>
  async (tree: MdNode, file: { path?: string }): Promise<void> => {
    const images: MdNode[] = [];
    const walk = (node: MdNode): void => {
      if (node.type === "image") images.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);

    const from = dirname(file.path ?? ".");
    await Promise.all(
      images.map(async (node) => {
        const url = node.url ?? "";
        // Same predicate `rehypeCopyLinkedFiles` uses to decide what it owns:
        // an external URL is not ours to measure, and the schema forbids one.
        if (!isRelativePath(url)) return;
        // `./img/foo.png?v=2` and `#anchor` are the path plus noise.
        const path = resolve(from, url.split(/[?#]/)[0]);
        let width: number;
        let height: number;
        try {
          const metadata = await getImageMetadata(await readFile(path));
          if (metadata == null) throw new Error("no dimensions in the file");
          ({ width, height } = metadata);
        } catch (err) {
          // Loud rather than silent: an unmeasurable image is a body that jumps
          // on load, and nobody looks at it again once it is HTML.
          throw new Error(`could not measure '${url}': ${(err as Error).message}`);
        }
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, width, height } };
      }),
    );
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
  remarkPlugins: [remarkImageSize],
  // Velite's .d.ts inlines unified's types instead of importing them, so the
  // `Plugin` @shikijs/rehype exports and the `Pluggable` Velite expects are two
  // identical declarations TypeScript refuses to unify. The cast bridges the two
  // copies and nothing else — the options above are checked against Shiki's own
  // type, one line up.
  rehypePlugins: [[rehypeShiki, shikiOptions] as unknown as RehypePlugin],
} satisfies MarkdownOptions;

/* ---------------------------------------------------------------------------
   SHARED FIELDS
   --------------------------------------------------------------------------- */

/**
 * The item's cover. `s.image()` copies the file to the output and returns
 * dimensions plus the blur placeholder; `alt` is a separate, required field
 * because `s.image()` has nowhere to store alt text, and an image without alt
 * does not meet the site's accessibility criterion.
 *
 * The path is relative to the file itself — the image lives in the item's
 * `img/` folder.
 */
const coverField = () =>
  s
    .object({
      src: s.image(),
      alt: s.string().min(3).max(160),
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
    // Everything stays INSIDE the checkout, relative to this file. The obvious
    // alternative — pointing `assets` at the site's `public/`, one level up —
    // creates and writes to a folder outside the repository: in the CI here that
    // leaks into the runner's parent directory, and locally it litters the
    // folder containing the clone.
    //
    // The content repository produces a self-contained bundle; who decides where
    // the files live is the site, which copies `.velite/static` into its own
    // `public/` before `next build`.
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
