# Mise en service de Murmure

Tout ce qui demande une action manuelle est ici, dans l'ordre. Compte une à deux heures pour la première mise en ligne.

Avant de commencer, l'app tourne déjà sur ta machine sans aucune clé : voir « Essayer en local » dans le [README](../README.md).

## Ce qu'il te faut

- Node 22 et pnpm (`corepack enable`).
- Docker, pour le Supabase local.
- Des comptes : [Google AI Studio](https://aistudio.google.com/), [Supabase](https://supabase.com/dashboard), [Cloudflare](https://dash.cloudflare.com/), [Trigger.dev](https://cloud.trigger.dev/), [Vercel](https://vercel.com/).

Les variables se renseignent dans `.env.local` (copie de `.env.example`). Ne mets jamais de clé dans une variable `NEXT_PUBLIC_*` autre que les deux de Supabase.

## 1. Gemini

1. Dans [AI Studio](https://aistudio.google.com/apikey), crée deux projets et une clé pour chacun :
   - **dev**, sans facturation (free tier). Google peut réutiliser ces données : n'y envoie que des textes de test.
   - **prod**, lié au compte de facturation qui reçoit tes crédits Google AI Pro.
2. Mets la clé **dev** dans `.env.local` (`GEMINI_API_KEY`), avec `AI_MODE=live`, puis lance le test réel, un appel par fonction :

   ```bash
   pnpm gemini:smoke --voice
   ```

   Il affiche les tokens et le coût de chaque étape, et écrit deux échantillons dans `.data/`. Écoute-les.

3. Refais-le avec la clé **prod**, en ajoutant le Batch (il n'existe pas en free tier) :

   ```bash
   pnpm gemini:smoke --batch
   ```

   Vérifie dans la [console de facturation](https://console.cloud.google.com/billing) que l'appel consomme bien les crédits.

**À vérifier à cette étape.** Deux points n'ont pas pu être validés sans clé :

- **TTS par Batch.** La doc du Batch API ne confirme pas les modèles TTS. Si `--batch` échoue, le mode Éco retombe tout seul sur l'API standard (après contrôle du budget) : il fonctionne, mais sans la remise de 50 %. Le format de requête est isolé dans `src/lib/gemini/batch.ts` : c'est le seul fichier à corriger.
- **Voix prédéfinies.** Les voix de départ `Achernar`, `Enceladus`, `Vindemiatrix` et `Sulafat` (`src/lib/prompts/voice-presets.ts`) viennent du catalogue Gemini officiel. Si l'une n'existe plus, le test TTS le signale : remplace son nom. `pnpm voices:list` affiche les autres voix du catalogue qui parlent français.
- **Langue de la synthèse.** Chaque appel envoie `language: "fr-FR"` dans `speech_config`. Le champ existe dans l'API, mais la doc n'en précise pas le format : si le test TTS le refuse, corrige `SPEECH_LANGUAGE` dans `src/lib/gemini/tts.ts`.

En mode Éco, le style par tour (« whispering ») n'est pas exprimable dans une requête Batch : le chuchoté passe par la balise `<whispers>` en tête de chaque passage, et le mode doux repose sur la voix seule. Un cours Éco garde cette forme même quand un passage retombe sur l'API standard, pour ne pas mélanger deux rendus. Préfère donc, en Éco, une voix créée pour le mode du cours (étape 7) à une voix prédéfinie.

## 2. Supabase

1. Crée un projet sur le [tableau de bord](https://supabase.com/dashboard). Dans **Project Settings → API Keys**, relève l'URL, la clé _publishable_ et une clé _secret_ :

   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SECRET_KEY=
   ```

2. Applique le schéma :

   ```bash
   pnpm exec supabase login
   ```

   ```bash
   pnpm exec supabase link --project-ref <ref-du-projet>
   ```

   ```bash
   pnpm db:push
   ```

3. **Authentication → URL Configuration** : _Site URL_ = l'adresse de prod (ex. `https://murmure.vercel.app`). Dans _Redirect URLs_, ajoute `https://<ton-domaine>/auth/confirm` et `http://localhost:3000/auth/confirm`.
4. **Authentication → Emails → Magic Link** et **Confirm signup** : remplace le corps des deux modèles par celui de `supabase/templates/magic_link.html`. Le lien doit pointer vers `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` : c'est ce qui permet d'ouvrir le lien sur un autre appareil que celui qui l'a demandé.
5. Renseigne `ALLOWED_EMAILS` (adresses séparées par des virgules). Une liste vide ne laisse entrer personne.
6. **Authentication → Sign In / Providers** : désactive **Allow new users to sign up** et laisse **Confirm email** activé. C'est ce réglage qui rend l'allowlist étanche : l'app crée elle-même le compte d'une adresse invitée (avec la clé secrète) au moment d'envoyer son premier lien. Inscriptions ouvertes, n'importe qui pourrait se créer une session en appelant l'API Supabase avec la clé publique.

L'envoi d'emails intégré à Supabase est limité à quelques messages par heure : suffisant pour deux personnes.

## 3. Cloudflare R2

1. **R2 → Create bucket** : `murmure-audio`, accès privé (ne coche aucun accès public).
2. **R2 → Manage API tokens → Create API token** : permission _Object Read & Write_, limitée à ce bucket. Relève :

   ```
   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   R2_BUCKET=murmure-audio
   ```

3. Applique le CORS (origines : `APP_URL`, `http://localhost:3000`, plus celles passées en argument) :

   ```bash
   pnpm r2:cors https://<ton-domaine>
   ```

   Sans CORS, le lecteur lit du silence. La propagation peut prendre 30 secondes.

## 4. Trigger.dev

1. Crée un projet sur [cloud.trigger.dev](https://cloud.trigger.dev/). Relève sa référence (**Project settings**) et la clé secrète de l'environnement **Production** (**API keys**) :

   ```
   TRIGGER_PROJECT_REF=proj_…
   TRIGGER_SECRET_KEY=tr_prod_…
   ```

2. Dans **Environment Variables** (environnement Production), ajoute ce dont les tâches ont besoin :

   | Variable                                                                 | Valeur                              |
   | ------------------------------------------------------------------------ | ----------------------------------- |
   | `APP_ENV`                                                                | `prod`                              |
   | `AI_MODE`                                                                | `live`                              |
   | `STORAGE_MODE`                                                           | `r2`                                |
   | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`                        | celles de l'étape 2                 |
   | `GEMINI_API_KEY`                                                         | la clé **prod**                     |
   | `GEMINI_MODEL_*`                                                         | seulement si tu changes les défauts |
   | `GLOBAL_MONTHLY_BUDGET_USD`                                              | plafond tous comptes, si tu en veux |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | celles de l'étape 3                 |
   | `TTS_STANDARD_CONCURRENCY`, `MAX_SOURCE_CHARS`                           | seulement si tu changes les défauts |

3. Déploie les tâches :

   ```bash
   pnpm exec trigger login
   ```

   ```bash
   pnpm trigger:deploy
   ```

   Ce déploiement n'a pas pu être essayé sans compte : c'est la première fois que les tâches seront compilées par Trigger.dev. En cas d'échec au build, la sortie de la commande indique le module en cause.

Pour développer contre Trigger.dev plutôt qu'en mode inline : `JOBS_MODE=trigger` dans `.env.local`, la clé `tr_dev_…`, puis `pnpm trigger:dev` à côté de `pnpm dev`.

## 5. Vercel

1. Importe le dépôt sur [vercel.com/new](https://vercel.com/new) (framework Next.js détecté, rien à régler).
2. Dans **Settings → Environment Variables** (Production), ajoute :

   | Variable                                            | Valeur                                                        |
   | --------------------------------------------------- | ------------------------------------------------------------- |
   | `APP_ENV`                                           | `prod`                                                        |
   | `AI_MODE`                                           | `live`                                                        |
   | `JOBS_MODE`                                         | `trigger`                                                     |
   | `STORAGE_MODE`                                      | `r2`                                                          |
   | `APP_URL`                                           | `https://<ton-domaine>`                                       |
   | Supabase (3 variables) et `ALLOWED_EMAILS`          | étape 2                                                       |
   | `GEMINI_API_KEY`                                    | la clé **prod** (le Studio voix appelle Gemini depuis Vercel) |
   | R2 (4 variables)                                    | étape 3                                                       |
   | `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF`         | étape 4                                                       |
   | `MONTHLY_BUDGET_USD`, `MAX_*`, `DAILY_COURSE_LIMIT` | seulement si tu changes les défauts                           |

   Pour pousser le contenu d'un fichier d'un coup : `vercel env add <NOM> production < valeur.txt`, ou colle le fichier `.env` dans l'éditeur du tableau de bord.

3. Déploie, puis ajoute ton domaine dans **Settings → Domains**. Si le domaine change, mets à jour `APP_URL`, les URLs de Supabase (étape 2.3) et relance `pnpm r2:cors`.

Les mêmes valeurs servent à Vercel et à Trigger.dev : garde-les dans un fichier `.env.production.local` (ignoré par git) pour les recopier des deux côtés.

## 6. Ambiances

Le bruit rose est synthétisé par FFmpeg : il fonctionne sans rien déposer. Pour les quatre autres :

1. Dépose un fichier libre de droits (CC0, par exemple depuis [Freesound](https://freesound.org/browse/tags/cc0/) ou [Pixabay](https://pixabay.com/sound-effects/)) par ambiance dans `assets/ambience/raw/`, nommé d'après son identifiant : `rain`, `library`, `fireplace`, `lofi` (extension libre : `.wav`, `.flac`, `.mp3`, `.ogg`). Vise une à dix minutes de son régulier, sans événement marquant.
2. Prépare-les (boucle sans couture, −28 LUFS, FLAC pour le serveur et AAC pour le lecteur) :

   ```bash
   pnpm ambience:prepare
   ```

3. Écoute `assets/ambience/out/`, puis envoie-les, avec les variables R2 de prod dans `.env.local` et `STORAGE_MODE=r2` :

   ```bash
   pnpm ambience:upload
   ```

4. Ajuste au besoin le gain par défaut de chaque ambiance dans `src/lib/ambiences.ts`.

Tant qu'une ambiance n'est pas installée, la choisir fait échouer le mix avec un message qui le dit ; « Bruit rose » marche toujours.

## 7. Voix

1. Connecte-toi une première fois à l'app (ton profil est créé à ce moment-là).
2. Crée les quatre presets (deux voix chuchotées, deux voix douces) dans le projet Gemini de la clé courante, avec les variables Supabase et R2 de prod dans `.env.local` :

   ```bash
   pnpm voices:seed
   ```

   Pour comparer avec les descriptions rédigées en français :

   ```bash
   pnpm voices:seed --fr
   ```

3. Écoute les voix dans le **Studio voix** : l'aperçu y est généré à la première écoute, avec le texte fixe, le modèle standard et le mastering d'un cours (environ 0,006 $ par voix et par mode). `.data/voices-seed/` ne contient que l'extrait brut renvoyé par Gemini. Garde ce qui sonne le mieux, supprime le reste, choisis ta voix par défaut.

Une voix est conçue pour un mode : « Murmure… » pour le chuchoté, « Voix douce… » pour le doux. Une description tient en une ou deux phrases et ne décrit que des traits permanents (âge, timbre, texture, débit) : c'est la consigne de la doc Gemini, une description longue rend la voix moins stable.

Les voix appartiennent à un projet Gemini : refais cette étape pour le projet dev (`APP_ENV=dev`) si tu veux des voix designées en développement. Gemini supprime une voix restée un an sans usage, et en accepte 200 par projet.

## 8. Vérifier la mise en ligne

1. Connexion par lien magique depuis ton téléphone.
2. Un cours de deux pages en **Express** : il doit être prêt en quelques minutes.
3. Dans **Réglages**, compare le coût estimé et le coût réel du cours, puis la console de facturation.
4. Sur le téléphone : installe l'app (« Ajouter à l'écran d'accueil »), télécharge le cours, passe en mode avion et lance la lecture.
5. Un cours de vingt pages en **Éco**. Le critère de la spec : coût réel ≤ estimation + 20 %.

Points à contrôler sur Safari iOS, jamais testés jusqu'ici : lecture écran verrouillé (le lecteur y passe d'office sur le pré-mix), commandes de l'écran verrouillé, et lecture hors-ligne.
