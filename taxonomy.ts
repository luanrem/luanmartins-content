/**
 * Os vocabularios fechados do conteudo. Valor fora daqui reprova o PR — e o que
 * impede `nextjs`, `next-js` e `next.js` virarem tres nomes para a mesma coisa
 * sem depender da disciplina de quem escreve.
 *
 * STACK e TAGS sao listas diferentes e nao se misturam: STACK e tecnologia,
 * TAGS e assunto. A faixa "Stack" da home NAO sai daqui — ela e moldura de UI e
 * mora no repositorio do site.
 *
 * Os rotulos viajam junto do dado porque o chip mostra `Next.js`, e nao
 * `nextjs`. Manter esse mapa no site criaria duas listas para sincronizar, que
 * e exatamente o problema que a taxonomia validada existe para matar.
 */

export const LOCALES = ["en", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

/** O idioma obrigatorio. Todo item precisa existir nele (ADR-0002). */
export const DEFAULT_LOCALE: Locale = "en";

/** Tecnologias. Vale para `work` e `experience`. */
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
  // backend
  "nestjs",
  "nodejs",
  "expressjs",
  "dotnet",
  "python",
  "postgres",
  "mongodb",
  "prisma",
  "typeorm",
  "graphql",
  "kestra",
  "openrouter",
  "websockets",
  // infraestrutura
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
  // outros
  "chrome-extension",
] as const;

export type StackId = (typeof STACK)[number];

/**
 * O rotulo que o chip mostra. Nome de tecnologia nao traduz, entao e um so.
 * O `Record` obriga: id novo sem rotulo nao compila.
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
  nestjs: "NestJS",
  nodejs: "Node.js",
  expressjs: "Express.js",
  dotnet: "C# / .NET",
  python: "Python",
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
  prisma: "Prisma",
  typeorm: "TypeORM",
  graphql: "GraphQL",
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

/** Assuntos. Vale para `work` e `blog`. */
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

/** Assunto traduz — o rotulo e por idioma. */
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
