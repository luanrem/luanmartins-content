# luanmartins-content

The text behind **[luanmartins.com](https://luanmartins.com)** — my work history,
the write-ups for the things I build, and the posts. It is not a website. It has
no styles, no components and no server. It is markdown with a schema.

The site itself lives in a separate repository. Content is here because text
changes far more often than code: keeping both in one place ties together two
lifecycles that have nothing to do with each other, and every fixed typo ends up
in the same history as the component refactors.

## How it reaches the site

```
write on a branch  →  open a PR  →  CI validates the schema
                                          ↓
                                   merge to main
                                          ↓
                              CI calls a Vercel Deploy Hook
                                          ↓
                        the site rebuilds as static HTML
```

**Merge is the publish button.** There is no other step.

The site is 100% static and never reads this repository at runtime — GitHub is
only involved while a build runs. A visitor never touches it, and if GitHub is
down the site does not notice.

## Repository layout

```
experience/<key>/<locale>.mdx     roles — the "Where I've worked" section
work/<key>/<locale>.mdx           projects — the "Selected work" section
log/<key>/<locale>.mdx            notes
site.yml                          the one loose value the site needs
taxonomy.ts                       the closed vocabularies
velite.config.mts                 the schema
```

One rule covers the whole repository:

```
<type>/<key>/<locale>.mdx
```

Three things are easy to confuse, so they are kept strictly separate:

|                    | What it is                                                                          | Where it comes from |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------- |
| **The folder**     | The item's identity. Pairs the languages together. **Never appears in a URL.**      | The folder name     |
| **The file name**  | The language. `en.mdx` or `pt.mdx`.                                                 | The file name       |
| **The slug**       | The public URL. Translated per language.                                            | The `slug` field    |

Neither the identity nor the language is typed into the frontmatter — a typed
field can drift between two files, a folder cannot. Because the folder never
appears in a URL, renaming it breaks nothing.

The key is the **item's** identity, not the company's: three roles at the same
employer are `exxonmobil-full-stack`, `exxonmobil-software-engineer` and
`exxonmobil-trainee`.

Assets belong next to the item they describe, inside its folder.

## Content types

### `experience`

Roles. **No slug and no route** — it renders as a section, not as a page.

| Field       | Type      | Required | Notes                                                                   |
| ----------- | --------- | -------- | ----------------------------------------------------------------------- |
| `company`   | string    | yes      |                                                                         |
| `role`      | string    | yes      |                                                                         |
| `location`  | string    | yes      | `Remote`, `Curitiba, Brazil`                                            |
| `note`      | string    | yes      | One line about the work. Leave the location out — it is already a field |
| `startDate` | `YYYY-MM` | yes      |                                                                         |
| `endDate`   | `YYYY-MM` | no       | **Absent means current.** There is no `current` field                   |
| `stack`     | `STACK[]` | yes      |                                                                         |

The body is **bullets only**. Each one becomes an entry in `highlights`; anything
that is not a list item fails the build rather than being dropped silently.

### `work`

Projects. Routed at `/<locale>/work/<slug>`.

| Field                       | Type                        | Required | Notes                                                                                                                       |
| --------------------------- | --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `title`                     | string                      | yes      |                                                                                                                             |
| `subtitle`                  | string                      | yes      | Short, under the page heading                                                                                               |
| `headline`                  | string                      | yes      | The sentence on the home card                                                                                               |
| `slug`                      | string                      | yes      | The URL. Translated per language                                                                                            |
| `kind`                      | `case-study` \| `overview`  | yes      | Decides the card's footer label. The _word_ is UI text and lives in the site                                                |
| `status.text`               | string                      | yes      | `Running in production`. Translated                                                                                         |
| `status.tone`               | `live` \| `idle`            | yes      | Not translated                                                                                                              |
| `order`                     | int ≥ 1                     | yes      | Showcase order. No ties allowed                                                                                             |
| `featured`                  | boolean                     | yes      | Controls appearing on the home page. `false` still has a page and a URL — it is **not** the same as unpublished              |
| `tags`                      | `TAGS[]`                    | yes      |                                                                                                                             |
| `stack`                     | `STACK[]`                   | yes      |                                                                                                                             |
| `links.repo` / `links.live` | url                         | no       |                                                                                                                             |
| `updatedAt`                 | date                        | yes      | **Stored, never displayed.** Feeds the sitemap's `lastmod`, so the page signals freshness without carrying a visible date    |
| `metadata`                  | derived                     | —        | Reading time and word count. Nobody fills it in. The case-study page shows reading time — it is the only cost signal there, since `updatedAt` never renders |

The body is the write-up, in full markdown.

### `log`

Notes. Routed at `/<locale>/log/<slug>`.

> The site calls this section **Log** — in the nav, in the design and in the
> route. The collection carries the same name so there is one word for one thing.

| Field         | Type    | Required | Notes                                                          |
| ------------- | ------- | -------- | -------------------------------------------------------------- |
| `title`       | string  | yes      |                                                                |
| `description` | string  | yes      | Also the meta description                                      |
| `slug`        | string  | yes      | The URL. Translated per language                               |
| `date`        | date    | yes      | Publication date. Sorts the list                               |
| `tags`        | `TAGS[]`| yes      |                                                                |
| `relatedWork` | key[]   | no       | Folder keys from `work/`. The build fails if one does not exist |

`relatedWork` is declared **only here**. The reverse — "posts about this project"
— is computed at build time, never written, and therefore never goes stale.

### `site.yml`

`resumeUrl` — a link to the CV. The PDF is hosted **outside** this repository;
see the ground rules below.

## Images

**Images live in an `img/` folder inside the item, next to the text that uses
them.** They are committed here like any other content — the repository stays
self-contained, so a checkout is everything needed to rebuild the site.

```
work/hermes/
  en.mdx
  pt.mdx
  img/
    architecture.png     ← referenced by both
```

Two ways to use one, and both take a **relative path**:

**In the body**, as ordinary markdown. The file is copied to the output, the URL
is rewritten to a content-hashed public path, and the build measures the file and
writes `width` and `height` onto the `<img>` — so the text around it does not
jump when the image finishes loading:

```markdown
![Diagram of the four pipeline stages](./img/architecture.png)
```

**As a cover**, in the frontmatter — for the card and for social previews:

```yaml
cover:
  src: ./img/architecture.png
  alt: Diagram of the four pipeline stages
```

A cover produces width, height and a `blurDataURL` placeholder alongside the
path, so the site can render it without layout shift. The same measurement runs
on body images; only the cover gets the blur, because a body image has nowhere to
carry it.

Rules the build enforces:

- **Alt text is required, everywhere.** An image in the body without alt text
  fails the build, and `cover.alt` is a required field. Accessibility is an
  acceptance criterion on the site, and a missing alt is only catchable here.
- **`alt` is translated; the file is not.** Both languages point at the same
  image and describe it in their own words.
- **Either both languages have a cover or neither does.** One card with an
  image and one without is a difference visitors would see.

The same image referenced from several files is stored once — the output name
is a hash of the contents.

The `img/` folder is a convention, not a rule the build enforces: paths are
resolved relative to the `.mdx` file, so any subfolder works. Keeping it uniform
is what makes an item's folder readable at a glance.

Everything generated lands in `.velite/`, which is git-ignored. Nothing is
written outside this repository.

## Languages

**`en` is required. `pt` is optional.** An item missing `en.mdx` fails the build;
an item with only `en.mdx` is perfectly fine.

That asymmetry is deliberate: translating never blocks publishing. Write in
English, merge, it is live. The translation can arrive months later in its own
PR, and the language toggle appears for that item on its own.

Two languages may share the same slug on purpose — a proper noun does not
translate. Slugs must be unique **within a language**, not globally.

Whatever is not text — `order`, `featured`, `updatedAt`, `status.tone`, `tags`,
`stack`, `links`, `date`, `relatedWork` — must match across the languages of one
item. The build enforces it, so the home page cannot show different cards in
different languages.

The CV is English-only, by choice.

## Taxonomy

`taxonomy.ts` holds two closed vocabularies that never mix:

- **`STACK`** — technologies (`nextjs`, `postgres`). Used by `work` and `experience`.
- **`TAGS`** — subjects (`architecture`, `career`). Used by `work` and `log`.

A value outside the list fails the build. That is what stops `nextjs`, `next-js`
and `next.js` from becoming three names for one thing.

To add a term, add the id to the list **and** its label in the same file. The
types will not compile with one and not the other. Technology labels are written
once; subject labels are written per language.

## Writing

```bash
pnpm install
pnpm dev      # watch, rebuilds as you type
pnpm build    # the same gate CI runs
```

- **A branch is a draft.** `main` is what is published — there is no `draft`
  field, because the branch already does that job.
- A file named `_something.mdx` is skipped by the build. Useful for a draft you
  want to commit but not publish yet.
- `pnpm build` is the exact command CI runs. If it is green here, it is green
  there.

## What fails a build

- Frontmatter that does not match the schema
- A `stack` or `tags` value outside the taxonomy
- A missing `en.mdx`
- A file whose name is not a language (`es.mdx` fails — it is not ignored)
- A slug repeated within the same language
- `relatedWork` pointing at a project that does not exist
- More than one role without an `endDate`
- Two `work` items sharing the same `order`
- Non-text fields that disagree between the languages of one item
- An `experience` body containing anything other than bullets
- An image without alt text, in the body or as a cover
- A cover present in one language of an item and missing in the other
- A body image the build cannot measure — a missing file, or one that is not an
  image

Failures are reported all at once, with the path of each offending file.

## Ground rules

**This repository is public and Git history is permanent.** Nothing here should
be anything you would not want traceable forever — including in a version you
later replaced. Deleting a file does not remove it from old commits.

In practice: **no phone numbers, no street addresses, no document numbers.** The
CV PDF is hosted outside this repository for exactly this reason; `site.yml`
holds only a link to it.

Draft branches are public too. Text that should not be seen half-finished stays
unpushed until it is presentable.

## Design decisions

The reasoning behind all of this lives in the site repository, and those
documents are the source of truth — this README is the operational summary:

- **ADR-0001** — the content model: separate repository, Velite, static build
- **ADR-0002** — i18n: language-prefixed routes, English as the default
