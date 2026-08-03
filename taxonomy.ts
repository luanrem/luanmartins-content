/**
 * The closed vocabularies of the content. A value outside them fails the PR —
 * that is what stops `nextjs`, `next-js` and `next.js` from becoming three names
 * for one thing without relying on the discipline of whoever is writing.
 *
 * STACK and TAGS are different lists and never mix: STACK is technology, TAGS is
 * subject. The home page's "Stack" band does NOT come from here — it is UI
 * chrome and lives in the site repository.
 *
 * The labels travel with the data because the chip shows `Next.js`, not
 * `nextjs`. Keeping that map in the site would create two lists to keep in sync,
 * which is exactly the problem a validated taxonomy exists to kill.
 */

export const LOCALES = ["en", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

/** The required language. Every item must exist in it (ADR-0002). */
export const DEFAULT_LOCALE: Locale = "en";

/** Technologies. Used by `work` and `experience`. */
export const STACK = [
  // frontend
  "react",
  "typescript",
  "javascript",
  "nextjs",
  "tailwindcss",
  "shadcn-ui",
  "tanstack-query",
  "zustand",
  "vite",
  "vitest",
  "jest",
  "playwright",
  "zod",
  "wxt",
  // backend
  "nestjs",
  "nodejs",
  "expressjs",
  "dotnet",
  "python",
  "postgres",
  "mongodb",
  "prisma",
  "drizzle",
  "typeorm",
  "graphql",
  "clerk",
  "kestra",
  "openrouter",
  "websockets",
  // infrastructure
  "docker",
  "kubernetes",
  "terraform",
  "ansible",
  "azure",
  "gcp",
  "elasticsearch",
  "proxmox",
  "traefik",
  "tailscale",
  // other
  "chrome-extension",
] as const;

export type StackId = (typeof STACK)[number];

/**
 * The label the chip shows. A technology name does not translate, so there is
 * only one. The `Record` forces the pair: a new id without a label will not
 * compile.
 */
export const STACK_LABELS: Record<StackId, string> = {
  react: "React",
  typescript: "TypeScript",
  javascript: "JavaScript",
  nextjs: "Next.js",
  tailwindcss: "Tailwind CSS",
  "shadcn-ui": "shadcn/ui",
  "tanstack-query": "TanStack Query",
  zustand: "Zustand",
  vite: "Vite",
  vitest: "Vitest",
  jest: "Jest",
  playwright: "Playwright",
  zod: "Zod",
  wxt: "WXT",
  nestjs: "NestJS",
  nodejs: "Node.js",
  expressjs: "Express.js",
  dotnet: "C# / .NET",
  python: "Python",
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
  prisma: "Prisma",
  drizzle: "Drizzle ORM",
  typeorm: "TypeORM",
  graphql: "GraphQL",
  clerk: "Clerk",
  kestra: "Kestra",
  openrouter: "OpenRouter",
  websockets: "WebSockets",
  docker: "Docker",
  kubernetes: "Kubernetes",
  terraform: "Terraform",
  ansible: "Ansible",
  azure: "Azure",
  gcp: "Google Cloud",
  elasticsearch: "Elasticsearch",
  proxmox: "Proxmox",
  traefik: "Traefik",
  tailscale: "Tailscale",
  "chrome-extension": "Chrome Extension APIs",
};

/** Subjects. Used by `work` and `blog`. */
export const TAGS = [
  "architecture",
  "infrastructure",
  "self-hosting",
  "automation",
  "ai",
  "frontend",
  "backend",
  "performance",
  "testing",
  "career",
] as const;

export type TagId = (typeof TAGS)[number];

/** A subject does translate — the label is per language. */
export const TAG_LABELS: Record<TagId, Record<Locale, string>> = {
  architecture: { en: "Architecture", pt: "Arquitetura" },
  infrastructure: { en: "Infrastructure", pt: "Infraestrutura" },
  "self-hosting": { en: "Self-hosting", pt: "Self-hosting" },
  automation: { en: "Automation", pt: "Automação" },
  ai: { en: "AI", pt: "IA" },
  frontend: { en: "Frontend", pt: "Frontend" },
  backend: { en: "Backend", pt: "Backend" },
  performance: { en: "Performance", pt: "Performance" },
  testing: { en: "Testing", pt: "Testes" },
  career: { en: "Career", pt: "Carreira" },
};
