/**
 * O schema deste repositorio. Ele roda em dois lugares, com este mesmo arquivo:
 * no CI daqui, a cada PR, so para validar; e no build da Vercel, para gerar os
 * dados que o site consome. Um schema so, num lugar so — e a razao de ele morar
 * junto do conteudo (ADR-0001).
 *
 * O `--strict` da linha de comando e obrigatorio. Sem ele a velite descarta o
 * item invalido com um aviso no log e termina verde, o que significa um texto
 * sumindo do site sem ninguem perceber.
 */
import { basename } from "node:path";
import { context, defineCollection, defineConfig, s } from "velite";
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
   IDENTIDADE — `<tipo>/<chave>/<locale>.mdx`

   A pasta e a identidade do item e nunca aparece numa URL; o nome do arquivo e
   o idioma; o `slug` do frontmatter e a URL publica, diferente por idioma.
   Identidade e idioma sao derivados do caminho, e nao digitados: campo digitado
   diverge entre dois arquivos, pasta nao tem como.
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

/** Devolve a identidade, ou a mensagem de erro que reprova o arquivo. */
const readIdentity = (): Identity | string => {
  const { file } = context();
  const stem = file.stem;
  const dir = file.dirname;
  if (stem == null || dir == null) return `caminho inesperado: '${file.path}'`;
  if (!isLocale(stem)) {
    const expected = LOCALES.map((locale) => `${locale}.mdx`).join(" ou ");
    return `'${stem}.mdx' nao e um idioma — o arquivo precisa se chamar ${expected}`;
  }
  const translationKey = basename(dir);
  if (!KEY_RE.test(translationKey)) {
    return `a pasta '${translationKey}' nao e uma chave valida (minusculas, digitos e hifen simples)`;
  }
  return { locale: stem, translationKey };
};

/* ---------------------------------------------------------------------------
   CORPO EM BULLETS (experience)

   A ADR diz "corpo: as conquistas em bullets". Em vez de compilar para HTML e
   o site ter que raspar <li>, as conquistas saem como string[] — o painel
   estiliza cada bullet, e o dado estruturado do curriculo sai de graca depois.

   O mdast esta populado mesmo sem `s.markdown()` na colecao (verificado na
   velite 0.4.0). A tipagem local evita trazer @types/mdast so por isto.
   --------------------------------------------------------------------------- */

interface MdNode {
  type: string;
  value?: string;
  alt?: string | null;
  url?: string;
  children?: MdNode[];
}

const plainText = (node: MdNode): string =>
  node.value ?? (node.children ?? []).map(plainText).join("");

interface Bullets {
  highlights: string[];
  /** Blocos de topo que nao sao lista — texto que seria descartado calado. */
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
 * Imagem no corpo sem texto alternativo. Acessibilidade e criterio de aceite no
 * contrato do site, e uma imagem sem alt so da para pegar aqui — depois de
 * virar HTML, ninguem mais olha.
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
   CAMPOS COMPARTILHADOS
   --------------------------------------------------------------------------- */

/**
 * A capa do item. `s.image()` copia o arquivo para a saida e devolve dimensoes
 * e o placeholder de blur; o `alt` e campo separado e obrigatorio porque o
 * `s.image()` nao tem onde guardar texto alternativo, e imagem sem alt nao
 * passa no criterio de acessibilidade do site.
 *
 * O caminho e relativo ao proprio arquivo — a imagem mora na pasta do item.
 */
const coverField = () =>
  s
    .object({
      src: s.image(),
      alt: s.string().min(3).max(160),
    })
    .optional();

/**
 * O slug nao usa `s.slug()`. A unicidade dela e global por escopo, e `en.mdx` e
 * `pt.mdx` do mesmo item podem legitimamente ter o mesmo slug — nome proprio
 * nao traduz. A unicidade que se quer e por idioma, e o grupo do `s.slug()` e
 * fixado quando o schema e construido, sem acesso ao arquivo. Formato aqui,
 * unicidade no `prepare`, que ve todos os documentos com o locale ja derivado.
 */
const slugField = () =>
  s
    .string()
    .min(3)
    .max(80)
    .regex(SLUG_RE, "o slug e minusculo, com palavras separadas por um hifen");

const stackField = () =>
  s
    .array(s.enum(STACK))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, "stack com item repetido")
    .transform((ids) => ids.map((id) => ({ id, label: STACK_LABELS[id] })));

/** O rotulo sai no idioma do arquivo — assunto traduz, tecnologia nao. */
const tagsField = () =>
  s
    .array(s.enum(TAGS))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, "tag repetida")
    .transform((ids, ctx) => {
      const identity = readIdentity();
      if (typeof identity === "string") {
        ctx.addIssue({ code: "custom", message: identity, fatal: true });
        return s.NEVER;
      }
      return ids.map((id) => ({ id, label: TAG_LABELS[id][identity.locale] }));
    });

/* ---------------------------------------------------------------------------
   COLECOES
   --------------------------------------------------------------------------- */

/** Um post que cita este projeto. Calculado no `prepare`, nunca escrito. */
interface RelatedPost {
  translationKey: string;
  locale: Locale;
  slug: string;
  title: string;
  date: string;
}

const experience = defineCollection({
  name: "Experience",
  // O padrao e largo de proposito: `es.mdx` deve REPROVAR com mensagem, e nao
  // sumir em silencio por nao casar com o glob.
  pattern: "experience/*/*.mdx",
  schema: s
    .object({
      company: s.string().min(2).max(60),
      role: s.string().min(2).max(80),
      /** "Remote", "Curitiba, Brazil". O "· remote" do painel e moldura. */
      location: s.string().min(2).max(60),
      /** Uma linha sobre o trabalho. Sem a localizacao, que ja e campo. */
      note: s.string().min(10).max(120),
      startDate: s.string().regex(MONTH_RE, "use YYYY-MM"),
      /** Ausente = cargo atual. Nao existe campo `current` no frontmatter. */
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
          message: `endDate '${data.endDate}' vem antes de startDate '${data.startDate}'`,
        });
        return s.NEVER;
      }
      const { highlights, stray } = readBullets();
      if (highlights.length < 3) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `o corpo precisa de ao menos 3 bullets, tem ${highlights.length}`,
        });
        return s.NEVER;
      }
      if (stray > 0) {
        ctx.addIssue({
          code: "custom",
          fatal: true,
          message: `o corpo so aceita bullets — ${stray} bloco(s) fora de lista seriam descartados`,
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
      /** Curto, embaixo do H1 da pagina do case study. */
      subtitle: s.string().min(4).max(60),
      /** A frase do cartao da home. */
      headline: s.string().min(20).max(220),
      slug: slugField(),
      /**
       * Decide o rotulo do rodape do cartao. Guarda o ESTADO, nao a palavra:
       * "case study" e moldura de UI, traduzida, e mora no site.
       */
      kind: s.enum(["case-study", "overview"]),
      /** O status do cartao. O texto traduz; o tom nao. */
      status: s.object({
        text: s.string().min(3).max(40),
        tone: s.enum(["live", "idle"]),
      }),
      order: s.number().int().min(1),
      /** Controla aparecer na home. `false` continua tendo pagina e URL. */
      featured: s.boolean(),
      tags: tagsField(),
      stack: stackField(),
      links: s
        .object({
          repo: s.string().url().optional(),
          live: s.string().url().optional(),
        })
        .default({}),
      /** Guardado e nunca exibido: alimenta o `lastmod` do sitemap. */
      updatedAt: s.isodate(),
      cover: coverField(),
      content: s.markdown(),
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
          message: `imagem sem texto alternativo no corpo: ${noAlt.join(", ")}`,
        });
        return s.NEVER;
      }
      return {
        ...data,
        locale: identity.locale,
        translationKey: identity.translationKey,
        // Preenchido no `prepare`. Declarado aqui para o tipo gerado ter o campo.
        relatedPosts: [] as RelatedPost[],
      };
    }),
});

const blog = defineCollection({
  name: "Post",
  pattern: "blog/*/*.mdx",
  schema: s
    .object({
      title: s.string().min(6).max(90),
      description: s.string().min(40).max(200),
      slug: slugField(),
      date: s.isodate(),
      tags: tagsField(),
      /** Chaves de pasta de `work/`. A existencia e checada no `prepare`. */
      relatedWork: s.array(s.string().regex(KEY_RE)).default([]),
      cover: coverField(),
      content: s.markdown(),
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
          message: `imagem sem texto alternativo no corpo: ${noAlt.join(", ")}`,
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
     * O PDF e hospedado FORA deste repositorio: aqui e publico e o historico do
     * Git e permanente, entao qualquer versao antiga do curriculo — com os
     * dados pessoais que ela tiver — ficaria rastreavel para sempre. Aqui mora
     * so o link.
     */
    resumeUrl: s.string().url().startsWith("https://"),
  }),
});

/* ---------------------------------------------------------------------------
   INVARIANTES QUE ATRAVESSAM ARQUIVOS

   Ficam todos no `prepare`, e nao espalhados em `superRefine`, por tres razoes:
   ele e o unico lugar que ve todas as colecoes de uma vez; reporta TODAS as
   violacoes num relatorio so, em vez de morrer na primeira; e nao depende do
   `config.cache`, que a propria velite marca como deprecado para a 1.0.

   O CLI imprime apenas `err.message` quando isto lanca — por isso a mensagem
   carrega o caminho de cada arquivo.
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
  // O conteudo e a raiz. O default da velite ('content') e relativo a ESTE
  // arquivo e apontaria para uma pasta que nao existe.
  root: ".",

  // Inerte na pratica: o CLI define `strict` com default `false`, e o resolver
  // faz `options.strict ?? loadedConfig.strict`, entao a linha de comando sempre
  // ganha. Fica escrito porque e a intencao, e porque protege `build()` chamado
  // por API. Quem garante de verdade e o `--strict` do script.
  strict: true,

  output: {
    // Tudo fica DENTRO do checkout, relativo a este arquivo. A alternativa
    // obvia — apontar `assets` para o `public/` do site, um nivel acima — cria
    // e escreve numa pasta fora do repositorio: no CI daqui isso vaza para o
    // diretorio pai do runner, e localmente suja a pasta que contem o clone.
    //
    // O repositorio de conteudo produz um pacote autocontido; quem decide onde
    // os arquivos moram e o site, que copia `.velite/static` para o `public/`
    // dele antes do `next build`.
    data: ".velite",
    assets: ".velite/static",
    base: "/static/",
    // NUNCA ligar: `clean` faz rm -rf em `output.assets`.
    clean: false,
  },

  collections: { experience, work, blog, site },

  prepare: (data) => {
    const problems: string[] = [];
    const at = (kind: string, key: string, locale?: string) =>
      `${kind}/${key}${locale == null ? "" : `/${locale}.mdx`}`;

    // 1. Ingles obrigatorio, portugues opcional (ADR-0002).
    const collections: ReadonlyArray<[string, readonly Localized[]]> = [
      ["experience", data.experience],
      ["work", data.work],
      ["blog", data.blog],
    ];
    for (const [kind, docs] of collections) {
      for (const [key, group] of groupByKey(docs)) {
        if (!group.some((doc) => doc.locale === DEFAULT_LOCALE)) {
          problems.push(
            `${at(kind, key)}: falta ${DEFAULT_LOCALE}.mdx — o ingles e obrigatorio`,
          );
        }
      }
    }

    // 2. Slug unico POR IDIOMA. Global reprovaria `en` e `pt` compartilhando o
    //    slug de um nome proprio, que e legitimo.
    const routed: ReadonlyArray<
      [string, ReadonlyArray<Localized & { slug: string }>]
    > = [
      ["work", data.work],
      ["blog", data.blog],
    ];
    for (const [kind, docs] of routed) {
      const seen = new Map<string, string>();
      for (const doc of docs) {
        const scope = `${doc.locale}:${doc.slug}`;
        const first = seen.get(scope);
        if (first != null) {
          problems.push(
            `${at(kind, doc.translationKey, doc.locale)}: slug '${doc.slug}' ja usado por ${first} no mesmo idioma`,
          );
          continue;
        }
        seen.set(scope, at(kind, doc.translationKey, doc.locale));
      }
    }

    // 3. O que nao e texto nao pode divergir entre os idiomas do mesmo item —
    //    senao a home mostraria cartoes diferentes em cada idioma.
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
          // A PRESENCA da capa, e nao o arquivo: o `alt` traduz, mas um idioma
          // com capa e o outro sem renderiza cartoes diferentes.
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
            `${at("work", key, doc.locale)}: divergem de ${DEFAULT_LOCALE}.mdx em kind/order/featured/updatedAt/status.tone/tags/stack/links ou na presenca de cover`,
          );
        }
      }
    }
    for (const [key, group] of groupByKey(data.blog)) {
      const fingerprint = (doc: (typeof data.blog)[number]) =>
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
            `${at("blog", key, doc.locale)}: date/tags/relatedWork divergem de ${DEFAULT_LOCALE}.mdx`,
          );
        }
      }
    }

    // 4. `relatedWork` aponta para projeto que existe.
    const workKeys = new Set(data.work.map((doc) => doc.translationKey));
    for (const post of data.blog) {
      for (const key of post.relatedWork) {
        if (!workKeys.has(key)) {
          problems.push(
            `${at("blog", post.translationKey, post.locale)}: relatedWork '${key}' nao existe em work/`,
          );
        }
      }
    }

    // 5. Um cargo atual, no maximo.
    const current = data.experience.filter(
      (doc) => doc.current && doc.locale === DEFAULT_LOCALE,
    );
    if (current.length > 1) {
      problems.push(
        `experience: ${current.length} cargos sem endDate (${current
          .map((doc) => doc.translationKey)
          .join(", ")}) — so um pode ser o atual`,
      );
    }

    // 6. `order` decide a vitrine da home; empate seria ordem aleatoria.
    const orders = new Map<number, string>();
    for (const doc of data.work) {
      if (doc.locale !== DEFAULT_LOCALE) continue;
      const first = orders.get(doc.order);
      if (first != null) {
        problems.push(
          `work: order ${doc.order} repetido em ${first} e ${doc.translationKey}`,
        );
        continue;
      }
      orders.set(doc.order, doc.translationKey);
    }

    if (problems.length > 0) {
      throw new Error(
        `\n${problems.length} problema(s) de conteudo:\n\n  ${problems.join("\n  ")}\n`,
      );
    }

    // 7. Indice inverso: "posts que falam deste projeto". Calculado, nunca
    //    escrito, e por isso nunca desatualiza. Cai no idioma do projeto; se o
    //    post nao existir naquele idioma, entra a versao em ingles.
    const postsByKey = groupByKey(data.blog);
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

    // 8. Ordem deterministica na saida, para o site nao reordenar em runtime.
    data.experience.sort((a, b) => b.startDate.localeCompare(a.startDate));
    data.work.sort(
      (a, b) => a.order - b.order || a.locale.localeCompare(b.locale),
    );
    data.blog.sort((a, b) => b.date.localeCompare(a.date));
  },
});
