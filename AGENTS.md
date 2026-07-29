# AGENTS.md

Contrato de trabalho deste repositório. Vale para qualquer agente de IA e para
mim. Descreve **restrições**; o [`README.md`](README.md) descreve o sistema, e
não se repete aqui.

> Este repositório é **conteúdo**, não código. O site que o consome mora em
> outro repositório, e as decisões de arquitetura (ADR-0001 e ADR-0002) moram
> lá — elas são a fonte de verdade.

## Idioma

| O quê | Idioma |
| --- | --- |
| Conteúdo (`.mdx`) | inglês obrigatório, português opcional |
| `README.md` | inglês — quem cai nele vem do perfil do GitHub |
| Este arquivo, comentários de código, mensagens de commit | PT-BR |
| Identificadores, chaves de pasta, slugs, termos de taxonomia | inglês |

Mensagens de commit em PT-BR **sem acentos**, imperativo, prefixo convencional
(`feat:`, `fix:`, `chore:`, `docs:`, `ci:`), um propósito por commit. **Sem
`Co-Authored-By` e sem qualquer menção a IA** — mesma regra do repositório do
site.

## Regras invioláveis

Se uma delas atrapalhar, **pare e pergunte** — não contorne.

1. **Nada de dado pessoal.** O repositório é público e o histórico do Git é
   permanente: telefone, endereço, documento ou qualquer coisa que você não
   queira rastreável para sempre **não entra**, nem num commit que será
   revertido depois. Apagar o arquivo não remove dos commits antigos. Cidade e
   estado são aceitos; já são públicos no site. O PDF do currículo é hospedado
   fora daqui exatamente por isso.

2. **Não inventar termo de taxonomia.** `stack` e `tags` só aceitam o que está
   em [`taxonomy.ts`](taxonomy.ts). Precisou de um termo novo? Adicione o id
   **e** o rótulo no mesmo arquivo — os tipos não compilam com um sem o outro.
   Nunca criar variante de grafia, plural ou idioma de um termo existente.

3. **A estrutura é uma regra só:** `<tipo>/<chave>/<locale>.mdx`. A pasta é a
   identidade do item e nunca vira URL; o nome do arquivo é o idioma; o `slug`
   do frontmatter é a URL. Nenhum dos dois primeiros é digitado no frontmatter.

4. **Toda imagem tem texto alternativo.** No corpo e na capa. É critério de
   aceite de acessibilidade no site, e depois de virar HTML ninguém mais pega.

5. **Não mergear.** Merge na `main` dispara um deploy do site — é passo humano.
   Agente abre PR e para aí.

## Escrita

- **Branch é rascunho.** Não existe campo `draft`: se não está pronto, não está
  na `main`. Arquivo com nome `_algo.mdx` é ignorado pelo build, para o caso de
  querer commitar sem publicar.
- **`featured: false` não é "não publicado".** O item continua com página e URL;
  só sai da vitrine da home.
- **Traduzir nunca bloqueia publicar.** Escreve em inglês, mergeia, está no ar.
  A tradução entra depois, em PR própria.
- Ao traduzir, **repita os campos que não são texto** (`order`, `featured`,
  `updatedAt`, `status.tone`, `tags`, `stack`, `links`, `date`, `relatedWork`,
  presença de `cover`). O build reprova se divergirem.
- `relatedWork` é declarado **só no post**. A lista inversa é calculada — nunca
  escreva "posts sobre este projeto" à mão.

## Antes de abrir PR

```bash
pnpm typecheck && pnpm build
```

São os mesmos dois que o CI roda, nessa ordem. Rodar local é só antecipar o
resultado.

O `--strict` vive dentro do `pnpm build` e **não é opcional**: sem ele a Velite
descarta o item inválido com um aviso e termina verde — um texto sumindo do site
sem ninguém perceber.

## O que este repositório não faz

- Não tem estilo, componente, layout ou runtime. É markdown com schema.
- Não decide como o conteúdo é exibido. Título de seção, rótulo de botão,
  numeral de faixa e texto de interface são **moldura**, e moram no repositório
  do site.
- A faixa "Stack" da home não sai daqui.
