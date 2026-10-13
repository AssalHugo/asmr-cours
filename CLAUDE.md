# Murmure — notes pour Claude Code

Spec complète : `docs/SPEC.md`. Setup manuel : `docs/SETUP.md`. Pipeline : `docs/ARCHITECTURE.md`.
Règles Next.js propres à cette version : @AGENTS.md

## Commandes

- `pnpm dev` · `pnpm build`
- Fin de phase : `pnpm typecheck && pnpm lint && pnpm test`
- `pnpm test:e2e` (Playwright) · `pnpm db:start` (Supabase local, Docker requis)
- pnpm vient de corepack (`~/.local/bin` dans le PATH).

## Versions retenues (vérifiées sur npm le 2026-10-13)

| Outil      | Version | Note                                                                                    |
| ---------- | ------- | --------------------------------------------------------------------------------------- |
| Node       | 22 LTS  |                                                                                         |
| pnpm       | 12.11   | builds natifs autorisés un par un dans `pnpm-workspace.yaml`                            |
| Next.js    | 16.4    | `proxy.ts` (plus `middleware.ts`) ; Cache Components désactivés (voir `next.config.ts`) |
| React      | 19.3    |                                                                                         |
| TypeScript | 5.9     | TS 7 existe mais `create-next-app` 16.4 fige `^5` : on suit                             |
| ESLint     | 9       | ESLint 10 existe mais `eslint-config-next` 16.4 fige `^9`                               |
| Tailwind   | 4.3     | config en CSS (`globals.css`), pas de `tailwind.config`                                 |
| shadcn     | 4.21    | base Radix, preset nova, `cn` vient du paquet `cn`                                      |
| zod        | 4.6     | `z.url()`, `z.prettifyError()`, `z.toJSONSchema()`                                      |
| Vitest     | 5.0     | config en `.mts`                                                                        |

## Conventions

- TypeScript strict, zéro `any`, `noUncheckedIndexedAccess`.
- zod à chaque frontière : env, routes, sorties LLM, payloads de tâches.
- `import "server-only"` sur tout module qui touche une clé. Vitest le remplace par `tests/stubs/server-only.ts`.
- Env : `src/lib/env.schema.ts` (schéma pur, testable), `src/lib/env.ts` (lecture paresseuse + groupes `r2Env()`, `geminiEnv()`…), `src/lib/env.public.ts` (navigateur).
- Toutes les pages sont dynamiques (session). Les lectures passent par `src/lib/data.ts` (client de session, RLS).
- FFmpeg : toujours `spawn` avec un tableau d'arguments.
- Textes d'interface en français.

## Modes sans clés

- `AI_MODE=mock` : LLM par fixtures, TTS sinusoïde, coût 0.
- `JOBS_MODE=inline` : le pipeline tourne dans le process Next, sans Trigger.dev.
- `STORAGE_MODE=local` : fichiers dans `.data/storage`, sans R2.
- Ces deux derniers modes sont des ajouts à la spec, pour le dev local et les E2E.

## Constats sur les API externes

- **Gemini TTS** : Interactions API (`ai.interactions.create`, clés snake_case), pas `generateContent`. Voix dans `generation_config.speech_config: [{ voice }]`, style dans l'annotation `speech_metadata.style` du bloc texte. Sortie unaire WAV 24 kHz mono 16 bits.
- **Voice design** : `ai.voices.create({ type: "prompted", store: true })` → id `voice_…`.
- **Tarifs** : identiques au §3.2 de la spec, doublement au 01/01/2027 confirmé.
