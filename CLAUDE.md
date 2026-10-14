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
- `courses` : le navigateur ne lit que les colonnes de `COURSE_COLUMNS` (`select("*")` avec la session est refusé) ; les colonnes internes se lisent avec la clé secrète, filtrées par `user_id`.
- Dépenses : toujours agrégées en SQL (`spend_since`, `course_cost`, vues), jamais additionnées ligne à ligne (plafond de 1 000 lignes).
- Mode admin (`/admin`, `ADMIN_EMAILS`) : `requireAdmin()` d'abord (404 sinon), puis lectures avec la clé secrète dans `src/lib/admin.ts`. Agrégats par fonctions SQL `admin_*`, exécutables par `service_role` seulement.
- Inscriptions Supabase fermées : le compte d'une adresse invitée est créé par `sendMagicLink` avec la clé secrète.
- FFmpeg : toujours `spawn` avec un tableau d'arguments.
- Textes d'interface en français.

## Modes sans clés

- `AI_MODE=mock` : LLM par fixtures, TTS sinusoïde, coût 0.
- `JOBS_MODE=inline` : le pipeline tourne dans le process Next, sans Trigger.dev.
- `STORAGE_MODE=local` : fichiers dans `.data/storage`, sans R2.
- Ces deux derniers modes sont des ajouts à la spec, pour le dev local et les E2E.

## Constats sur les API externes

- **Gemini** : tout passe par l'Interactions API (`ai.interactions.create`, clés snake_case), y compris le texte structuré (`response_format: { type: "text", mime_type: "application/json", schema }`) et le thinking (`generation_config.thinking_level` : `low` au minimum pour Flash, `minimal` pour Flash-Lite). Usage dans `interaction.usage` (`total_input_tokens`, `total_output_tokens`, `total_thought_tokens`).
- **Gemini TTS** : voix et langue dans `generation_config.speech_config: [{ voice, language }]`, style dans l'annotation `speech_metadata.style` du bloc texte. Sortie unaire WAV 24 kHz mono 16 bits dans `interaction.output_audio`. Balises entre chevrons, en anglais (`<whispers>`, `<breath>`, `<short pause>`) ; le texte est lu mot à mot.
- **Voix** : une voix par mode (`VOICE_PRESETS`), description d'une ou deux phrases, traits permanents seulement (doc voice design). L'aperçu du Studio passe par le mastering d'un cours.
- **Batch** : format generateContent (JSONL, `speechConfig.voiceConfig`), sans style par tour : `ttsDelivery` balise le texte d'un cours Éco (`<whispers>`), y compris quand un chunk retombe sur l'API standard. Le TTS en batch n'est pas confirmé par la doc : à valider avec `pnpm gemini:smoke --batch` ; repli automatique sur l'API standard.
- **Voice design** : `ai.voices.create({ store: true, voice: { type: "prompted", prompted: { input } } })` → id `voice_…`.
- **Tarifs** : identiques au §3.2 de la spec, doublement au 01/01/2027 confirmé.
- **Trigger.dev 4.7** : `schemaTask`, `queue({ name, concurrencyLimit: 1 })` + `concurrencyKey` au déclenchement, `wait.for`, `metadata.set`, `auth.createPublicToken`. Extension `ffmpeg({ version: "7" })`, condition de build `react-server` pour `server-only`. Jamais déployé à ce jour.
- **Serwist** : paquet `@serwist/turbopack` (Next 16 compile avec Turbopack). Le service worker est servi par `src/app/serwist/[path]/route.ts`, actif en production seulement, et compilé à part (`tsconfig.sw.json`).
- **Google Drive** (facultatif, `NEXT_PUBLIC_GOOGLE_*`) : tout côté navigateur dans `src/components/upload/drive-picker.ts` — jeton GIS (`drive.file`), sélecteur Picker, téléchargement `alt=media` (ou `export` en PDF pour Docs et Slides), puis dépôt par `uploadFiles`. Les origines Google n'entrent dans la CSP que si les deux variables sont définies.
- **FFmpeg** : 7.0.2 en local (`ffmpeg-static`). `loudnorm` coûte le double en stéréo : la mise au niveau se fait en mono, la stéréo ensuite. `acrossfade` ne sort rien si ses deux entrées viennent du même flux découpé par `atrim` : ouvrir le fichier deux fois.

## Tests

- `pnpm test` : unitaires + intégration (pipeline complet en mémoire avec vrai FFmpeg, RLS contre Supabase local si `.env.local` existe). Environ quatre minutes.
- `pnpm test:e2e` : build de production sur le port 3100, navigateur avec AAC (Chrome ou Brave), Supabase local. Connexion par lien magique fabriqué avec la clé secrète locale, sans contournement dans l'app.
- `page.goto` ne navigue pas quand Playwright simule le hors-ligne : passer par `location.assign`.

## À valider avec de vraies clés

Rien de ce qui suit n'a pu être exécuté : appels Gemini réels (dont le champ `language` de la synthèse et la balise `<whispers>` en Batch), TTS par Batch, déploiement Trigger.dev et Vercel, R2 (CORS compris), import Google Drive, Safari iOS. L'ordre des vérifications est dans `docs/SETUP.md`.
