# AGENTS.md

Working contract for this repository. It applies to any AI agent and to me. It
describes **constraints**; the [`README.md`](README.md) describes the system, and
is not repeated here.

> This repository is **content**, not code. The site that consumes it lives in
> another repository, and the architecture decisions (ADR-0001 and ADR-0002)
> live there — they are the source of truth.

## Language

Everything written here is in **English**: this file, code comments, commit
messages, PR titles and bodies. Content itself is **English required,
Portuguese optional** — see the README.

> The site repository still writes documentation, comments and commits in
> PT-BR. That divergence is deliberate and scoped: this repository is public,
> its README already targets whoever arrives from the GitHub profile, and its
> content is mostly English. Do not "fix" one to match the other.

Commit messages: conventional prefix (`feat:`, `fix:`, `chore:`, `docs:`,
`ci:`), imperative, one purpose per commit. **No `Co-Authored-By` and no mention
of AI whatsoever** — same rule the site repository keeps, and it overrides the
tool's default.

Commits written before this rule stay in Portuguese. Rewriting history to
satisfy a new convention would destroy the only memory we have of it.

## Non-negotiable rules

If one of them gets in the way, **stop and ask** — do not work around it.

1. **No personal data.** This repository is public and Git history is permanent:
   a phone number, an address, a document number, or anything you would not want
   traceable forever **does not go in** — not even in a commit you plan to revert
   later. Deleting the file does not remove it from old commits. City and state
   are fine; they are already public on the site. The CV PDF is hosted outside
   this repository for exactly this reason.

2. **Never invent a taxonomy term.** `stack` and `tags` only accept what is in
   [`taxonomy.ts`](taxonomy.ts). Need a new one? Add the id **and** its label in
   the same file — the types will not compile with one and not the other. Never
   create a spelling, plural or language variant of a term that already exists.

3. **The structure is one rule:** `<type>/<key>/<locale>.mdx`. The folder is the
   item's identity and never becomes a URL; the file name is the language; the
   `slug` in the frontmatter is the URL. Neither of the first two is typed into
   the frontmatter.

4. **Every image has alt text.** In the body and on the cover. It is an
   accessibility acceptance criterion on the site, and once it becomes HTML
   nobody catches it any more. Images live in `<type>/<key>/img/`, referenced by
   a relative path (`./img/file.png`) — never an external URL, or the repository
   stops being able to rebuild the site on its own.

5. **Never merge.** A merge into `main` triggers a deploy of the site — that is a
   human step. An agent opens a PR and stops there.

## Writing

- **A branch is a draft.** There is no `draft` field: if it is not ready, it is
  not on `main`. A file named `_something.mdx` is skipped by the build, for when
  you want to commit without publishing.
- **`featured: false` is not "unpublished".** The item keeps its page and its
  URL; it only leaves the home page showcase.
- **Translating never blocks publishing.** Write in English, merge, it is live.
  The translation lands later, in its own PR.
- When translating, **repeat the fields that are not text** (`order`, `featured`,
  `updatedAt`, `status.tone`, `tags`, `stack`, `links`, `date`, `relatedWork`,
  presence of `cover`). The build fails if they disagree.
- `relatedWork` is declared **only on the post**. The reverse list is computed —
  never write "posts about this project" by hand.

## Before opening a PR

```bash
pnpm typecheck && pnpm build
```

Those are the same two the CI runs, in that order. Running them locally only
brings the result forward.

`--strict` lives inside `pnpm build` and **is not optional**: without it Velite
drops the invalid item with a warning and exits green — a text vanishing from the
site with nobody noticing.

## What this repository does not do

- No styles, no components, no layout, no runtime. It is markdown with a schema.
- It does not decide how content is displayed. Section titles, button labels,
  band numerals and interface copy are **chrome**, and live in the site
  repository.
- The home page's "Stack" band does not come from here.
