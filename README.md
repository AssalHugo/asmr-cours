# Murmure

Tes cours, chuchotés. Murmure transforme un PDF, des photos de notes ou un texte en piste audio de révision, lue d'une voix chuchotée ou douce, avec chapitres, sous-titres et ambiance en boucle (pluie, bibliothèque, cheminée, lofi, bruit rose).

App personnelle pour une ou deux personnes : aucun GPU, tout passe par l'API Gemini, avec un budget mensuel plafonné (10 $ par défaut).

## Ce que fait l'app

- **Nouveau cours** en trois étapes : source, réglages (voix, façon de parler, ambiance, tu ou vous), estimation du coût pour les quatre combinaisons Éco/Express × Standard/Économie.
- **Génération suivie en direct**, reprise possible après un échec sans rien repayer.
- **Contrôle de fidélité** : chaque chapitre est comparé au cours, et les écarts sont affichés.
- **Lecteur** : chapitres, ±15 s, vitesse, voix et ambiance réglables séparément, texte du passage en cours, minuteur de sommeil, reprise, commandes de l'écran verrouillé.
- **Hors-ligne** : app installable, cours téléchargeables sur l'appareil.
- **Studio voix** : création d'une voix à partir d'une description.
- **Budget** : jauge du mois, coût estimé et réel de chaque cours, refus au-delà du plafond.

## Essayer en local, sans aucune clé

Le mode mock fait tourner tout le parcours sans réseau ni dépense : le texte est découpé tel quel, la voix est un simple signal sonore, FFmpeg assemble et mixe pour de vrai.

Il faut Node 22, pnpm (`corepack enable`) et Docker.

```bash
pnpm install
```

```bash
pnpm db:start
```

Copie `.env.example` vers `.env.local`, puis renseigne les trois variables Supabase affichées par la commande précédente et ton adresse dans `ALLOWED_EMAILS`. Les modes par défaut du fichier (`AI_MODE=mock`, `JOBS_MODE=inline`, `STORAGE_MODE=local`) conviennent.

```bash
pnpm dev
```

Ouvre <http://localhost:3000>, demande un lien de connexion et récupère-le dans la boîte mail locale : <http://127.0.0.1:54324>.

Pour la vraie voix et la mise en ligne, suis [docs/SETUP.md](docs/SETUP.md).

## Commandes

| Commande                                           | Rôle                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev` · `pnpm build` · `pnpm start`           | App Next.js                                                                     |
| `pnpm typecheck` · `pnpm lint` · `pnpm test`       | Contrôles (les tests lancent le vrai FFmpeg)                                    |
| `pnpm test:e2e`                                    | Parcours complet dans un navigateur, hors-ligne compris (Supabase local requis) |
| `pnpm db:start` · `pnpm db:reset` · `pnpm db:push` | Supabase local, ou migrations vers le projet lié                                |
| `pnpm trigger:dev` · `pnpm trigger:deploy`         | Tâches Trigger.dev                                                              |
| `pnpm gemini:smoke`                                | Un appel réel par fonction Gemini, avec son coût                                |
| `pnpm r2:cors`                                     | Politique CORS du bucket R2                                                     |
| `pnpm ambience:prepare` · `pnpm ambience:upload`   | Préparation et envoi des ambiances                                              |
| `pnpm voices:seed`                                 | Création des voix prédéfinies de Murmure                                        |

`pnpm test:e2e` a besoin d'un navigateur qui décode l'AAC (Chrome, Brave) : le Chromium de Playwright ne le fait pas. Il le trouve tout seul, ou via `E2E_BROWSER_PATH`.

## Modes

| Variable       | Valeurs              | Effet                                                         |
| -------------- | -------------------- | ------------------------------------------------------------- |
| `AI_MODE`      | `live` · `mock`      | `mock` : aucun appel Gemini, coût nul                         |
| `JOBS_MODE`    | `trigger` · `inline` | `inline` : le pipeline tourne dans le process Next (dev, E2E) |
| `STORAGE_MODE` | `r2` · `local`       | `local` : fichiers dans `.data/storage`                       |
| `APP_ENV`      | `dev` · `prod`       | Projet Gemini auquel les voix sont rattachées                 |

En production : `live`, `trigger`, `r2`, `prod`.

## Organisation du code

```
src/app/            pages, Server Actions, routes (uploads, audio, jeton temps réel, service worker)
src/components/     interface : assistant, lecteur, Studio voix, budget
src/hooks/          use-player, use-course-run
src/lib/            pricing, estimate, budget, env, stockage, Gemini, providers IA, audio (FFmpeg), lecteur
src/trigger/        tâches Trigger.dev et étapes du pipeline (steps/)
supabase/           migrations et modèles d'email
scripts/            CORS R2, ambiances, voix, test réel Gemini, banc d'essai
tests/              unitaires, intégration (pipeline mock + FFmpeg réel), E2E
```

Le fonctionnement du pipeline, du lecteur et du hors-ligne est décrit dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). La spécification d'origine est dans [docs/SPEC.md](docs/SPEC.md).

## Limites connues

- Les tarifs de Gemini doublent le 1er janvier 2027. Tous les calculs passent par `src/lib/pricing.ts`, qui bascule à cette date.
- Le suivi des dépenses est une estimation : la console de facturation Google fait foi.
- En mode Éco, le chuchotement repose sur la voix choisie (le style par tour n'existe pas en Batch) : préfère une voix créée dans le Studio.
- Le clonage de sa propre voix est prévu côté serveur (`replicateVoice`) mais n'a pas encore d'écran.
