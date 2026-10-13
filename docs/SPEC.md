# PROMPT CLAUDE CODE — « Murmure » : cours → pistes audio ASMR

> Nom de travail : **Murmure** (modifiable). Langue de l'UI et des contenus : **français**.
> Ce document est la spécification complète. Tu livres l'application entière, testée et déployable.

---

## 0. Comment tu travailles

1. **Phase 0 obligatoire**
   - Lis ce document en entier, puis déplace-le dans `docs/SPEC.md`.
   - Passe en plan mode et rends un plan par phases (§16) avec une liste de tâches.
   - Exécute ensuite phase par phase, sans attendre de validation sauf blocage réel.
2. **Ne devine aucune API externe.**
   - Avant chaque intégration (Gemini, Trigger.dev, Supabase, R2, Serwist), lis la doc officielle (§19).
   - Vérifie signatures, noms de champs, formats et limites.
   - Consigne versions et choix dans `CLAUDE.md`.
3. **Versions**
   - Dernières versions **stables**, vérifiées sur npm.
   - Conventions actuelles de chaque outil (ex. `middleware` vs `proxy` selon la version de Next.js).
4. **Fin de phase** = `pnpm typecheck && pnpm lint && pnpm test` au vert, puis commit (Conventional Commits).
5. **Clé absente ≠ blocage**
   - `AI_MODE=mock` fait tourner tout le pipeline sans réseau (§13).
   - Toute action manuelle de ma part va dans `docs/SETUP.md`, avec l'ordre exact et les liens.
6. **Questions** : seulement si c'est bloquant. Sinon applique les défauts de ce document et note l'hypothèse dans le rapport final.
7. **Qualité**
   - TypeScript strict, zéro `any`.
   - zod à chaque frontière : env, routes, sorties LLM, payloads de tâches.
   - `import "server-only"` sur tout module qui touche une clé.
8. Si une skill de design front est disponible, utilise-la pour §11.

---

## 1. Contexte & objectif

- **Usage** : app perso et non commerciale (1 à 2 utilisatrices).
- **Fonction** : transformer des cours (PDF, photos de notes de révision, texte collé) en **pistes audio de révision en français**, voix chuchotée ou douce façon ASMR.
- **Ambiances en boucle** : pluie, bibliothèque, cheminée, lofi, bruit rose.
- **Volume type** : 15–30 pages ≈ 50 000 caractères ≈ 55–76 min d'audio.
- **Contraintes dures**
  - **Aucun GPU**, ni serveur ni client : zéro inférence locale, tout passe par l'API Gemini.
  - **Budget ≈ 10 $/mois** de crédits Gemini : estimer, tracer et plafonner chaque dollar (§3).
- **Succès V1** :
  - elle dépose un PDF, choisit voix, mode et ambiance, voit le coût estimé et lance ;
  - elle récupère une piste écoutable sur laptop et téléphone : chapitres, mix réglable, minuteur de sommeil, hors-ligne.

---

## 2. Architecture (décisions figées)

| Couche | Choix | Notes |
|---|---|---|
| Front | Next.js (App Router) + TypeScript + Tailwind | hébergé sur Vercel Hobby |
| UI kit | shadcn/ui (Radix), restylé | design §11 |
| PWA | Serwist | installable, audio hors-ligne avec requêtes `Range` |
| Auth + DB | Supabase : Postgres, Auth par magic link, RLS | `@supabase/ssr` |
| Fichiers audio | Cloudflare R2 : API S3, URLs présignées | **jamais** Supabase Storage (50 Mo max par fichier en free) |
| Jobs | Trigger.dev v4+ | tâches longues sans timeout, extension FFmpeg, realtime |
| IA | API Gemini, SDK `@google/genai` (≥ 2.24) | §3 |
| Audio | FFmpeg dans les tâches Trigger.dev | §8.7 |
| Tests | Vitest + Playwright | §13 |
| Outillage | pnpm, Node LTS actuelle | |

**Flux**
1. Upload navigateur → R2 (URL présignée).
2. Une Server Action crée le cours et déclenche `generate-course` (Trigger.dev).
3. Le pipeline appelle Gemini texte (extraction, réécriture, vérification), puis Gemini TTS.
4. FFmpeg assemble, masterise et mixe.
5. Les rendus sont publiés dans R2 et lus par le lecteur.

---

## 3. Modèles Gemini, coûts, budget

### 3.1 Répartition

| Rôle | Variable d'env (défaut) | Règle |
|---|---|---|
| Extraction PDF/images → sections | `GEMINI_MODEL_TEXT` = `gemini-3.8-flash` | PDF natif, sortie JSON structurée |
| Réécriture ASMR | `GEMINI_MODEL_TEXT` | thinking au minimum (facturé comme de la sortie) |
| Contrôle de fidélité | `GEMINI_MODEL_CHECK` = `gemini-3.5-flash-lite` | il n'existe pas de 3.8 Flash-Lite texte |
| Voix finale (qualité Standard) | `GEMINI_MODEL_TTS` = `gemini-3.8-flash-tts` | Batch API en mode Éco |
| Qualité Économie, essais en Studio voix | `GEMINI_MODEL_TTS_LITE` = `gemini-3.8-flash-lite-tts` | audio 33 % moins cher |

### 3.2 Tarifs → `src/lib/pricing.ts`

Prix en USD par million de tokens. Bascule automatique selon la date de l'appel.

| Modèle | Standard in/out jusqu'au 31/12/2026 | Standard in/out dès le 01/01/2027 | Batch in/out jusqu'au 31/12/2026 | Batch in/out dès le 01/01/2027 |
|---|---|---|---|---|
| gemini-3.8-flash | 0,75 / 3,75 | 1,50 / 7,50 | 0,375 / 1,875 | 0,75 / 3,75 |
| gemini-3.5-flash-lite | 0,30 / 2,50 | 0,30 / 2,50 | 0,15 / 1,25 | 0,15 / 1,25 |
| gemini-3.8-flash-tts | 0,50 / 9,00 | 1,00 / 18,00 | 0,25 / 4,50 | 0,50 / 9,00 |
| gemini-3.8-flash-lite-tts | 0,50 / 6,00 | 1,00 / 12,00 | 0,25 / 3,00 | 0,50 / 6,00 |

- La sortie texte inclut le thinking.
- L'audio compte 25 tokens par seconde générée.
- Le Batch n'existe pas en free tier.
- Revérifie la page pricing (§19) avant de figer les constantes.

### 3.3 Règles

- **`tier` du cours**
  - **Éco** (défaut) : TTS via Batch API, −50 %, délai non garanti (jusqu'à 24 h).
  - **Express** : API standard.
- **`quality` du cours**
  - **Standard** (défaut) : `GEMINI_MODEL_TTS`.
  - **Économie** : `GEMINI_MODEL_TTS_LITE`.
- **Thinking** au niveau le plus bas supporté, sur toutes les étapes texte. Le paramètre exact est à vérifier dans la doc.
- **Estimation avant lancement** (`src/lib/estimate.ts`)
  - Durée = caractères ÷ débit. Débit par défaut : 12 caractères/s en chuchoté, 13,5 en doux.
  - Dès qu'il y a 3 cours, le débit devient la moyenne mesurée pour la même voix et le même mode.
  - Tokens texte ≈ caractères ÷ 3,5.
  - Afficher le coût pour les 4 combinaisons (Éco/Express × Standard/Économie).
- **Journal**
  - Chaque appel écrit dans `usage_events` : tokens prompt, sortie et thinking (depuis les métadonnées d'usage), secondes audio, tier, coût calculé.
  - Afficher l'estimation et le réel côte à côte.
- **Garde-fou budget**
  - Dépense du mois + estimation > `monthly_budget_usd` → refus avec message clair.
  - Au-delà de 80 % du budget → confirmation explicite, et Express désactivé.
- **Cache TTS par hash** (§8.4) : un chunk inchangé n'est jamais refacturé.
- **Deux clés Gemini**
  - **dev** : projet AI Studio sans facturation (free tier). Google réutilise ces données, donc uniquement des textes de test.
  - **prod** : projet lié au compte de facturation qui reçoit les crédits.
- Le suivi de l'app reste une estimation. La console de facturation fait foi.

---

## 4. Fonctionnalités V1 et critères d'acceptation

### 4.1 Authentification
- Magic link Supabase, avec allowlist `ALLOWED_EMAILS` (refus poli sinon).
- Session SSR, toutes les routes de l'app protégées.
- `profile` créé automatiquement au premier login.

### 4.2 Nouveau cours (assistant en 3 étapes)

1. **Source**, au choix :
   - PDF (≤ `MAX_UPLOAD_MB`, ≤ `MAX_PDF_PAGES`) ;
   - photos de notes : JPG, PNG, WEBP, HEIC (vérifier les MIME acceptés par Gemini), 30 images maximum ;
   - texte collé (≤ `MAX_SOURCE_CHARS`).

   Upload direct navigateur → R2, avec barre de progression.
2. **Réglages**
   - Titre : proposé par l'extraction, modifiable.
   - Mode : `chuchoté` (défaut) ou `doux`.
   - Voix, ambiance et niveau d'ambiance.
   - Tutoiement (défaut) ou vouvoiement.
   - Tier Éco/Express et qualité Standard/Économie.
   - Bouton « Écouter la voix » : échantillon mis en cache par voix × mode.
3. **Estimation**
   - Durée estimée, coût de chaque combinaison, budget restant du mois.
   - Alerte au-delà de 80 % du budget.
   - Bouton « Générer ».

### 4.3 Progression
- Statuts : `queued → extracting → rewriting → verifying → synthesizing → waiting_batch → assembling → mastering → ready | failed`.
- Temps réel via Trigger.dev Realtime, avec un token public limité au run : étape, %, coût engagé, durée produite.
- `failed` : message lisible et bouton « Reprendre » (reprise idempotente, §8.0).
- Fin de génération : toast, plus une notification locale si l'onglet est ouvert.

### 4.4 Bibliothèque
- Cartes : titre, durée, date, statut, progression d'écoute, badge hors-ligne, alerte de fidélité éventuelle.
- Recherche par titre.
- Suppression : rendus et sources du cours ; le cache TTS global est conservé.

### 4.5 Détail d'un cours
- Sections avec durée, statut de vérification et rapport d'écarts (§8.3).
- « Régénérer cette section »
  - Réécriture et TTS de la seule section.
  - Grâce au cache, seuls les chunks modifiés sont payés.
  - Puis réassemblage.
- « Changer l'ambiance du pré-mix » : nouveau mix FFmpeg seul, coût IA nul.

### 4.6 Lecteur → §10

### 4.7 Studio voix
- Liste des presets designés (§9.4) et des voix créées ; choix de la voix par défaut.
- Création par description (voice design Gemini)
  - Les itérations d'écoute utilisent `GEMINI_MODEL_TTS_LITE`.
  - L'échantillon final est généré avec `GEMINI_MODEL_TTS` puis stocké.
- P2 (optionnel) : « Cloner ma voix »
  - Enregistrement (MediaRecorder) de 20 à 30 s chuchotées.
  - Plus l'audio de consentement exigé par Gemini (voice replication).
  - **Uniquement sa propre voix.**
- Les voix Gemini sont rattachées à un **projet** Gemini : colonne `env` (`dev` | `prod`), filtrée selon `APP_ENV`.
- Mettre à jour `last_used_at` à chaque usage. Côté Gemini : voix supprimée après 1 an sans usage, 200 voix maximum par projet.

### 4.8 Réglages & budget
- Jauge du mois (estimation) et historique par cours (estimé vs réel).
- Tarifs en vigueur, avec l'alerte « tarifs ×2 au 01/01/2027 ».
- Défauts : voix, mode, ambiance, tier, qualité, forme d'adresse, budget mensuel.

### 4.9 Hors-ligne (PWA)
- App installable : manifest et icônes.
- « Télécharger » par cours : voix, pré-mix, ambiance web, chapitres et sous-titres dans Cache Storage.
- **Clé de cache stable**, indépendante de la signature présignée.
- Stocker des réponses complètes (200) et servir les `Range` depuis le cache (plugin range requests).
- `navigator.storage.persist()`, affichage de l'espace utilisé, suppression possible.

---

## 5. Arborescence cible

```
.
├─ CLAUDE.md
├─ docs/                    SPEC.md · SETUP.md · ARCHITECTURE.md (Mermaid du pipeline)
├─ supabase/migrations/
├─ trigger.config.ts        extension FFmpeg
├─ scripts/                 r2-cors.ts · ambience-prepare.ts · ambience-upload.ts · voices-seed.ts
├─ assets/ambience/raw/     sources CC0 (gitignored si lourdes)
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/
│  │  ├─ (app)/library/ · new/ · courses/[id]/ · play/[id]/ · voices/ · settings/
│  │  └─ api/               uploads/presign · audio/[courseId] · realtime-token · …
│  ├─ components/           ui/ · player/ · course/ · upload/ · budget/
│  ├─ hooks/                use-player.ts · use-course-run.ts
│  ├─ lib/
│  │  ├─ env.ts · pricing.ts · estimate.ts · budget.ts · ambiences.ts
│  │  ├─ supabase/          server.ts · browser.ts · admin.ts
│  │  ├─ r2.ts
│  │  ├─ gemini/            client.ts · text.ts · tts.ts · batch.ts · voices.ts · usage.ts
│  │  ├─ llm/               provider.ts · gemini.ts · mock.ts
│  │  ├─ tts/               provider.ts · gemini.ts · mock.ts
│  │  ├─ pipeline/          schemas.ts · chunker.ts · status.ts
│  │  ├─ audio/             ffmpeg.ts · master.ts · mix.ts · chapters.ts · silence.ts
│  │  └─ prompts/           extract.ts · rewrite.ts · verify.ts · voice-presets.ts
│  └─ trigger/              generate-course.ts · regenerate-section.ts · remix.ts · voice-sample.ts · steps/
└─ tests/                   unit/ · integration/ · e2e/ · fixtures/
```

Interface TTS, pensée pour ajouter d'autres providers plus tard (ex. Fish Audio) :

```ts
type VoiceMode = "whisper" | "soft";
type TtsRequest = { key: string; text: string; voiceId: string; style: string; model: string };
type TtsResult  = { key: string; wav: Buffer; sampleRate: number; durationMs: number; usage: Usage };

interface TtsProvider {
  id: "gemini" | "mock";
  renderChunkText(segments: Segment[]): string;        // applique les balises propres au provider
  synthesize(req: TtsRequest): Promise<TtsResult>;     // appel standard
  submitBatch?(reqs: TtsRequest[]): Promise<{ jobId: string }>;
  pollBatch?(jobId: string): Promise<{ state: "running" | "done" | "failed"; results?: TtsResult[] }>;
}
```

---

## 6. Données (Supabase)

```sql
create type course_status as enum ('queued','extracting','rewriting','verifying','synthesizing',
  'waiting_batch','assembling','mastering','ready','failed');
create type voice_mode as enum ('whisper','soft');
create type tts_tier as enum ('eco','express');
create type tts_quality as enum ('standard','economy');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  default_voice_id uuid,
  default_mode voice_mode not null default 'whisper',
  default_ambience text not null default 'rain',
  default_tier tts_tier not null default 'eco',
  default_quality tts_quality not null default 'standard',
  address_form text not null default 'tu' check (address_form in ('tu','vous')),
  monthly_budget_usd numeric(8,2) not null default 10,
  created_at timestamptz not null default now()
);

create table voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  env text not null check (env in ('dev','prod')),
  provider text not null default 'gemini',
  provider_voice_id text not null,
  kind text not null check (kind in ('prebuilt','designed','replicated')),
  label text not null,
  description text,
  sample_key text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  source_kind text not null check (source_kind in ('pdf','images','text')),
  source_keys text[] not null default '{}',
  source_chars int,
  mode voice_mode not null,
  tier tts_tier not null,
  quality tts_quality not null,
  voice_id uuid references voices,
  ambience text not null,
  ambience_gain_db numeric(4,1) not null default 0,
  address_form text not null default 'tu',
  status course_status not null default 'queued',
  progress smallint not null default 0,
  error text,
  trigger_run_id text,
  batch_job_id text,
  est_cost_usd numeric(8,4),
  actual_cost_usd numeric(8,4) not null default 0,
  duration_ms int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  idx int not null,
  title text not null,
  source_text text not null,
  key_terms jsonb not null default '[]',
  key_facts jsonb not null default '[]',
  script jsonb,
  verified boolean not null default false,
  verify_report jsonb,
  start_ms int,
  duration_ms int,
  unique (course_id, idx)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  section_id uuid not null references sections on delete cascade,
  idx int not null,
  text text not null,
  caption text not null,
  style text not null,
  pause_after_ms int not null default 0,
  hash text not null,
  audio_key text,
  start_ms int,
  duration_ms int,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  unique (course_id, idx)
);

create table renders (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  kind text not null check (kind in ('voice','mix')),
  ambience text,
  key text not null,
  duration_ms int not null,
  bytes bigint,
  created_at timestamptz not null default now()
);

create table usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references courses on delete set null,
  step text not null,
  model text not null,
  tier text not null check (tier in ('standard','batch')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  audio_seconds numeric(10,2) not null default 0,
  cost_usd numeric(10,5) not null,
  created_at timestamptz not null default now()
);

create table playback_progress (
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  position_ms int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);
```

- **RLS sur toutes les tables**
  - `user_id = auth.uid()` directement.
  - Pour `sections`, `chunks` et `renders`, via une jointure sur `courses`.
  - Les tâches utilisent la clé secrète et filtrent **toujours** par `user_id`.
- **Triggers et vues**
  - Trigger `updated_at` sur `courses`.
  - Création du profil à l'inscription.
  - Vue `monthly_spend` : somme de `cost_usd` du mois courant par utilisateur.
- Les migrations passent par la CLI Supabase.

---

## 7. Stockage (Cloudflare R2)

Bucket privé `R2_BUCKET`. Clés (identifiants UUID, non devinables) :

| Contenu | Clé |
|---|---|
| Sources | `uploads/{userId}/{courseId}/{fichier}` |
| Cache TTS | `tts-cache/{hash}.wav` |
| Rendus | `courses/{courseId}/voice.m4a` · `courses/{courseId}/mix-{ambience}.m4a` |
| Méta | `courses/{courseId}/chapters.json` · `courses/{courseId}/captions.json` |
| Ambiances | `ambience/master/{id}.flac` (mix serveur) · `ambience/web/{id}.m4a` (lecteur) |
| Voix | `voices/{voiceId}/sample.wav` |

- **URLs présignées** : PUT pour l'upload (15 min), GET pour la lecture (6 h).
- **CORS**, appliqué par `pnpm r2:cors`
  - Origines : app prod et localhost.
  - Méthodes : `GET`, `PUT`, `HEAD`.
  - En-têtes autorisés : `Range`, `Content-Type`.
  - En-têtes exposés : `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`.
- Le CORS est **indispensable** : sans lui, Web Audio lit du silence sur un `<audio crossorigin="anonymous">`.
- Audio servi en `audio/mp4`, encodé avec `-movflags +faststart`.

---

## 8. Pipeline (Trigger.dev)

### 8.0 Principes
- **Orchestration** : une tâche `generate-course` appelle des étapes idempotentes.
  - Chaque étape lit l'état en base et saute ce qui est déjà fait.
  - Relancer = reprendre là où ça s'est arrêté.
- **Suivi** : à chaque étape, `metadata` du run mis à jour (statut, %, coût engagé), et même état persisté dans `courses`.
- **Retries** : 3 essais, backoff exponentiel avec jitter. Sur 429, respecter `Retry-After`.
- **Concurrence**
  - Une file avec `concurrencyKey = userId` et une limite de 1 : un cours à la fois par utilisateur.
  - TTS standard : `TTS_STANDARD_CONCURRENCY` (défaut 4).
- **Attentes longues** (batch) via `wait.for` : le run est checkpointé, l'attente n'est pas facturée.
- **Fichiers temporaires** dans un répertoire de travail, nettoyé en fin de tâche.
- **Machine** : la plus petite qui traite 1 h d'audio. Mesure-la et documente-la.

### 8.1 Extraction (`GEMINI_MODEL_TEXT`)
- **Entrée** : fichiers R2 ou texte.
  - PDF et images envoyés tels quels à Gemini.
  - Inline si petit, sinon via la Files API, selon les limites de la doc.
- **Sortie** structurée (schéma zod converti en JSON schema) :

```ts
const ExtractedCourse = z.object({
  title: z.string().min(1).max(200),
  language: z.string(),                      // "fr" attendu
  sections: z.array(z.object({
    title: z.string(),
    content: z.string().min(200),
    keyTerms: z.array(z.string()).max(12),
    keyFacts: z.array(z.string()).max(15),
  })).min(1),
});
```

- Post-traitement côté code : fusionner ou redécouper les sections pour tenir entre 1 500 et 6 000 caractères.

### 8.2 Réécriture (`GEMINI_MODEL_TEXT`, thinking minimal)
- Une requête par section, 3 en parallèle.
- **Entrée** : la section, le mode, la forme d'adresse, et sa position (première ou dernière section).
- **Sortie** :

```ts
const Script = z.object({
  segments: z.array(z.object({
    text: z.string().min(1).max(400),
    pauseAfterMs: z.number().int().min(200).max(3500),
    breathBefore: z.boolean(),
  })).min(1),
});
```

- **Validation côté code**
  - Aucun markdown, emoji, crochet ni chevron dans `text`.
  - Longueur totale entre 0,9 et 1,4 fois la source ; sinon une relance.

### 8.3 Vérification (`GEMINI_MODEL_CHECK`)

```ts
const VerifyReport = z.object({
  ok: z.boolean(),
  missingFacts: z.array(z.string()),
  alteredFacts: z.array(z.string()),
  inventedClaims: z.array(z.string()),
});
```

- Si `ok=false` : relancer la réécriture avec le rapport en feedback, au maximum 2 fois.
- Après ces 2 relances : `verified=false`, on continue, et l'alerte est visible dans l'UI.

### 8.4 Chunking (`src/lib/pipeline/chunker.ts`, fonction pure, testée)

- **Où couper un chunk**
  - après un segment dont `pauseAfterMs ≥ 1000` : FFmpeg insère alors le silence exact ;
  - en fin de section ;
  - dès que le chunk dépasse 900 caractères.
- Si un passage sans grande pause dépasse 900 caractères, couper au segment qui porte la plus longue pause.
- Taille cible : 400 à 900 caractères. **Jamais de coupe au milieu d'une phrase.**
- **Rendu du texte Gemini** (`renderChunkText`)

  | Cas | Rendu |
  |---|---|
  | pause < 600 ms | simple espace |
  | 600 à 999 ms | ` <short pause> ` |
  | `breathBefore` | `<breath> ` en tête de segment |

  Les balises restent **en anglais**, même pour un texte français.
- `caption` = texte sans balises, pour les sous-titres.
- `hash = sha256(model | voiceId | style | text)`.

### 8.5 Synthèse
- **Style** (champ de style par tour de parole, voir la doc) : `"whispering"` en mode chuchoté, `"soft and calm"` en mode doux.
  - Rien d'autre : les longues consignes de style font dériver la voix.
  - La voix designée porte déjà le timbre.
- **Voix** : le `provider_voice_id` de la voix du cours.
- **Cache** : si `tts-cache/{hash}.wav` existe, on le réutilise, coût 0.
- **Express** : appels standard en parallèle (concurrence §8.0).
- **Éco**
  - Un seul job Batch pour tous les chunks manquants ; statut `waiting_batch`.
  - Poll toutes les 3 min via `wait.for`.
  - Au-delà de 24 h : bascule en Express pour le reste, après contrôle du budget.
- **Format batch** : vérifie dans la doc comment exprimer voix et style. Si le style n'est pas exprimable, on s'appuie sur la voix designée seule ; documente ce cas.
- **Sortie** : WAV 24 kHz mono 16 bits (défaut des requêtes unaires, à vérifier), stocké tel quel dans le cache.
- **Coût** : secondes audio × 25 tokens, journalisé dans `usage_events`.
- Le batch n'existe pas en free tier : teste le mode Éco avec la clé prod sur un petit texte.

### 8.6 Assemblage
- Télécharger les chunks.
- Retirer les silences de début et de fin de chaque chunk avec `silenceremove`, pour des pauses exactes.
  - Seuil prudent, autour de −60 dB, avec 80 ms de marge.
  - Vérifier que les attaques chuchotées ne sont pas coupées.
- Générer les silences (`anullsrc=r=24000:cl=mono`) à la durée `pause_after_ms`, mis en cache par durée.
- Concaténer avec le concat demuxer et `-c copy` (format identique).
- Durées mesurées via ffprobe, qui renseignent :
  - `chunks.start_ms` et `duration_ms`, et `sections.start_ms` et `duration_ms` ;
  - `captions.json` : `[{ startMs, endMs, text }]` ;
  - `chapters.json` : `[{ title, startMs, durationMs }]` ;
  - un fichier `chapters.ffmeta` au format FFMETADATA1.

### 8.7 Mastering & mix (FFmpeg)

Toujours `spawn` avec un tableau d'arguments, jamais une chaîne shell. Constantes ajustables dans `src/lib/audio/`.

```bash
# 1) Master voix → WAV intermédiaire (évite un double encodage avec perte)
#    loudnorm sort en 192 kHz : aresample 48 kHz obligatoire
ffmpeg -i voice_raw.wav -af "highpass=f=70,deesser=i=0.4,acompressor=threshold=-24dB:ratio=2:attack=15:release=200,equalizer=f=160:t=q:w=1:g=1.5,loudnorm=I=-19:TP=-2:LRA=7,aresample=48000" -ac 1 voice_master.wav

# 2) Voix seule, pour le mix en direct dans le lecteur
ffmpeg -i voice_master.wav -f ffmetadata -i chapters.ffmeta -map 0:a -map_chapters 1 \
  -c:a aac -b:a 96k -movflags +faststart voice.m4a

# 3) Pré-mix, pour l'écran verrouillé et le hors-ligne
ffmpeg -i voice_master.wav -stream_loop -1 -i ambience.flac -f ffmetadata -i chapters.ffmeta \
  -filter_complex "[0:a]pan=stereo|c0=c0|c1=c0[v];[1:a]volume=${AMB_GAIN_DB}dB,afade=t=in:d=8[bg];[v][bg]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${FADE_START_S}:d=12[out]" \
  -map "[out]" -map_chapters 2 -c:a aac -b:a 128k -movflags +faststart mix-${AMB}.m4a
```

- Le `deesser` est indispensable : le chuchoté synthétique siffle sur les « s ».
- Vérifie que `deesser`, `loudnorm` et l'option `normalize` d'`amix` existent dans la version de FFmpeg fournie par l'extension Trigger.dev.
- Ordres de grandeur : voix ≈ 43 Mo/h, pré-mix ≈ 58 Mo/h.

### 8.8 Publication
- Upload vers R2 de `voice.m4a`, `mix-{amb}.m4a`, `chapters.json` et `captions.json`.
- Mise à jour en base : `renders`, puis `courses` (`ready`, `duration_ms`, `actual_cost_usd`).

### 8.9 Tâches annexes
- `regenerate-section` : réécriture, vérification et TTS d'une section (avec le cache), puis réassemblage et remix.
- `remix` : nouveau pré-mix avec une autre ambiance (FFmpeg seul).
- `voice-sample` : échantillon d'aperçu par voix × mode, mis en cache.

---

## 9. Prompts LLM (`src/lib/prompts/`, versionnés, avec tests de rendu)

### 9.1 Extraction — system

```
Tu es un extracteur de contenu pédagogique. Entrée : un cours (PDF, photos de notes ou texte).
Objectif : restituer FIDÈLEMENT le contenu, structuré en sections, pour une lecture audio.
Règles :
- Ne résume pas, ne reformule pas, n'ajoute rien. Corrige seulement les erreurs d'OCR évidentes.
- Supprime en-têtes, pieds de page, numéros de page, renvois vers des figures sans contenu.
- Tableaux → phrases (une ligne = une phrase). Formules → texte prononçable en français
  (ex. « x au carré plus deux x »). Schémas → brève description si le texte en dépend.
- Sections cohérentes de 1 500 à 6 000 caractères, en suivant les titres du cours.
- keyTerms : 3 à 12 termes techniques par section, orthographe exacte.
- keyFacts : définitions, chiffres, dates, formules, règles indispensables (15 max par section), formulés exactement.
- Réponds uniquement avec le JSON demandé.
```

### 9.2 Réécriture ASMR — system (variables `{{…}}` injectées par le code)

```
Tu écris le script audio d'une séance de révision ASMR en français, lue d'une voix {{mode_label}}
par une narratrice unique et bienveillante. Tu t'adresses à l'auditrice en {{address_form}}.

Fidélité (prioritaire) :
- Chaque keyFact apparaît, exact. Chaque keyTerm garde son orthographe exacte.
- N'invente aucun fait, chiffre, exemple chiffré ni référence absents de la source.
  Une analogie est permise si elle est présentée comme une image (« c'est un peu comme… »).

Structure :
1. Ouverture douce (1 à 2 phrases) qui annonce le thème.
   {{si première section}} Accueil calme et invitation à respirer, 3 phrases maximum.
2. Explication progressive, une idée à la fois, dans l'ordre de la source.
3. Récapitulatif en 2 à 4 phrases courtes reprenant les keyFacts essentiels.
   {{si dernière section}} 4. Clôture apaisante en 2 phrases, sans information nouvelle.

Style oral :
- 20 mots maximum par phrase, une idée par phrase, syntaxe simple.
- Listes → énumération parlée (« d'abord… ensuite… enfin… »).
- Sigles développés à la première occurrence ; nombres et symboles écrits comme ils se prononcent.
- Aucun markdown, emoji, crochet, chevron, didascalie ni indication de jeu : le texte est lu mot à mot.
- Longueur totale entre 0,9 et 1,4 fois la source.

Pauses (pauseAfterMs) :
- 300 à 700 ms entre deux phrases d'une même idée ;
- 1 200 à 2 000 ms entre deux idées ;
- 2 500 à 3 500 ms après le récapitulatif.
breathBefore = true au plus une fois tous les 4 segments, avant une idée nouvelle.

Réponds uniquement avec le JSON demandé.
```

`mode_label` : « chuchotée, très proche » (chuchoté) ou « douce et posée » (doux). `address_form` : « tu » ou « vous ».

### 9.3 Vérification — system

```
Tu contrôles la fidélité d'un script audio par rapport à sa source.
Entrées : la section source (content, keyTerms, keyFacts) et le script (segments).
Signale uniquement :
- missingFacts : keyFacts absents du script ;
- alteredFacts : faits présents mais modifiés (chiffre, terme, sens) ;
- inventedClaims : affirmations factuelles du script absentes de la source
  (les analogies présentées comme telles sont permises).
ok = true seulement si les trois listes sont vides.
Réponds uniquement avec le JSON demandé.
```

### 9.4 Voice design — presets (`voices-seed`, à créer dans **chaque** projet Gemini)

> Révisé le 2026-10-13 d'après la doc Gemini (voice design) : une voix par mode, une ou deux phrases, traits permanents seulement. Les quatre presets en vigueur sont dans `src/lib/prompts/voice-presets.ts` ; les deux ci-dessous sont ceux d'origine. Le texte d'aperçu fait désormais une vingtaine de secondes.

- **Murmure doux** : `A calm young adult French woman from Paris. Soft, breathy, intimate whisper, very close to the microphone. Slow, warm and reassuring pacing, clear articulation, no vocal fry.`
- **Murmure grave** : `A calm adult French man. Low, soft, breathy whisper, very close to the microphone. Slow, warm and reassuring, clear articulation, no vocal fry.`
- Teste aussi ces descriptions rédigées en français, et garde la version qui sonne le mieux.
- Texte d'aperçu fixe : « Installe-toi confortablement… <breath> Aujourd'hui, on revoit ensemble les bases du cours, tranquillement, une idée après l'autre. »

---

## 10. Lecteur audio (`use-player.ts` + machine d'état idle/loading/playing/paused/ended)

- **Voix**
  - Chaîne : `<audio crossorigin="anonymous" preload="metadata">` → `MediaElementAudioSourceNode` → `GainNode` voix.
  - **Ne jamais décoder la piste voix entière** : 1 h décodée en Float32 occupe plusieurs centaines de Mo.
- **Ambiance**
  - Fichier web court (2 à 4 min), décodé en `AudioBuffer`.
  - Boucle par **deux sources alternées avec un crossfade equal-power de 3 s**, vers un `GainNode` ambiance.
  - Pas de `<audio loop>` : il laisse un blanc au raccord.
- **Gain maître** pour les fondus : pause douce en 300 ms, minuteur de sommeil.
- **Ambiance changée à chaud** : crossfade de 2 s entre l'ancienne et la nouvelle.
- **Commandes** : lecture/pause, ±15 s, chapitres précédent/suivant, chapitre courant affiché.
- **Vitesse** : `playbackRate` de 0,8 à 1,2, avec `preservesPitch` (préfixe `webkit` si nécessaire).
- **« Afficher le texte »** : sous-titre du chunk courant depuis `captions.json`, avec un défilement doux.
- **Minuteur de sommeil** : 15, 30, 45 ou 60 min, ou fin du chapitre. Fondu de 30 s, puis pause.
- **Reprise**
  - Position sauvegardée toutes les 10 s, dans localStorage et `playback_progress`.
  - Reprise proposée à l'ouverture du cours.
- **Media Session**
  - Métadonnées : titre, chapitre, artwork.
  - Actions : play, pause, seek ±15 s, chapitre précédent/suivant, `setPositionState`.
- **Mode écran verrouillé**
  - Activé automatiquement sur iOS, en toggle ailleurs.
  - Sur iOS, Web Audio est suspendu au verrouillage : on lit le **pré-mix** dans un `<audio>` simple, sans Web Audio.
  - L'ambiance est alors celle choisie au rendu.
- **AudioContext** : créé ou débloqué au premier geste utilisateur ; gérer les états `suspended` et `interrupted`.

---

## 11. UI/UX & design system

- **Ambiance « veille de révision »**
  - Thème sombre par défaut : indigo nuit et prune, accents sable chaud et lavande.
  - Thème clair : crème.
  - Contraste AA, jamais de blanc pur.
- **Typographie** (via `next/font`) : une serif douce pour les titres, une sans-serif très lisible pour l'interface.
- **Formes** : rayons généreux, ombres très diffuses, beaucoup d'espace, aucun bruit visuel.
- **Mobile-first**
  - Cibles tactiles ≥ 44 px.
  - Utilisable à une main, dans le noir.
- **Animations** : micro-animations lentes (le bouton lecture « respire » sur un cycle de 4 à 6 s), en respectant `prefers-reduced-motion`.
- **Écrans** : Connexion · Bibliothèque · Nouveau cours (assistant) · Progression · Détail cours · Lecteur plein écran · Studio voix · Réglages/Budget.
- **Textes** de l'interface en français, ton chaleureux et bref. États vides, erreurs et chargements soignés.

---

## 12. Sécurité & limites

- **Clés**
  - Côté serveur et tâches uniquement.
  - Aucune donnée sensible dans une variable `NEXT_PUBLIC_*`.
- **RLS** partout (§6).
- **Uploads**
  - MIME et taille vérifiés côté serveur.
  - Noms de fichiers normalisés, clés R2 en UUID.
- **Limites (variables d'env)**
  - `MAX_UPLOAD_MB=50`
  - `MAX_PDF_PAGES=80`
  - `MAX_SOURCE_CHARS=150000`
  - `DAILY_COURSE_LIMIT=5`
  - un seul cours en génération par utilisatrice
- **R2** : URLs présignées courtes, aucun bucket public.
- **Données** : en prod, le contenu des cours n'est envoyé qu'au projet Gemini payant.
- **Budget** : §3.3, non contournable côté client (contrôle serveur).

---

## 13. Tests & mode mock

- **`AI_MODE=mock`**
  - LLM : fixtures JSON valides.
  - TTS : sinusoïde douce de durée proportionnelle au texte.
  - Coût : 0.
- **Unitaires (Vitest)**
  - chunker et `renderChunkText` ;
  - `pricing` (dont la bascule 2026/2027) ;
  - `estimate` et garde-fou budget ;
  - builders d'arguments FFmpeg ;
  - schémas zod ;
  - rendu des prompts.
- **Intégration**
  - Pipeline complet en mode mock sur un PDF fixture de 3 pages.
  - Résultat attendu : rendus produits, chapitres et sous-titres cohérents.
  - Reprise après une interruption simulée, sans recalculer les chunks déjà faits.
- **FFmpeg réel** sur une fixture de 10 s : durée, fréquence d'échantillonnage, chapitres présents, loudness approximative (`ebur128`).
- **E2E (Playwright)** : login (bypass de test), cours mock, progression, lecteur, changement d'ambiance, minuteur.

---

## 14. Variables d'environnement (`src/lib/env.ts`, validées par zod, `.env.example` commenté)

```
APP_ENV=dev                                  # dev | prod (filtre des voix Gemini)
AI_MODE=live                                 # live | mock

# Supabase (noms de clés selon la doc actuelle)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ALLOWED_EMAILS=

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL_TEXT=gemini-3.8-flash
GEMINI_MODEL_CHECK=gemini-3.5-flash-lite
GEMINI_MODEL_TTS=gemini-3.8-flash-tts
GEMINI_MODEL_TTS_LITE=gemini-3.8-flash-lite-tts

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=murmure-audio

# Trigger.dev
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_REF=

# Budget & limites
MONTHLY_BUDGET_USD=10
TTS_STANDARD_CONCURRENCY=4
MAX_UPLOAD_MB=50
MAX_PDF_PAGES=80
MAX_SOURCE_CHARS=150000
DAILY_COURSE_LIMIT=5
```

Documente comment synchroniser ces variables vers Vercel et Trigger.dev.

---

## 15. Setup manuel & déploiement (`docs/SETUP.md`, à rédiger pas à pas)

1. **Gemini**
   - Créer deux projets AI Studio :
     - **dev**, sans facturation (free tier) ;
     - **prod**, lié au compte de facturation où les crédits Google AI Pro sont appliqués.
   - Vérifier qu'un appel test prod consomme bien les crédits.
2. **Supabase**
   - Créer le projet et activer l'auth par magic link.
   - Déclarer les URLs de redirection : prod et localhost.
   - `pnpm db:push`.
3. **Cloudflare R2**
   - Créer un bucket privé et un token API en lecture/écriture limité à ce bucket.
   - Appliquer le CORS : `pnpm r2:cors`.
4. **Trigger.dev**
   - Créer le projet, renseigner les variables d'env.
   - Déployer : `pnpm trigger:deploy`.
5. **Vercel** : import du repo, variables d'env, domaine.
6. **Ambiances**
   - Déposer 4 à 6 fichiers CC0 (pluie, bibliothèque, cheminée, lofi, bruit rose) dans `assets/ambience/raw/`.
   - `pnpm ambience:prepare` :
     - boucle sans couture par crossfade fin → début ;
     - normalisation à −28 LUFS ;
     - sorties FLAC (serveur) et AAC (web).
   - Puis `pnpm ambience:upload`.
   - Gain par défaut de chaque ambiance dans `src/lib/ambiences.ts`.
7. **Voix** : `pnpm voices:seed` (presets §9.4) dans chaque projet, puis écoute des échantillons.

**Scripts `package.json`** : `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `trigger:dev`, `trigger:deploy`, `db:push`, `r2:cors`, `ambience:prepare`, `ambience:upload`, `voices:seed`.

---

## 16. Phases & Definition of Done

| Phase | Contenu | Definition of Done |
|---|---|---|
| 0 | Lecture, plan, vérif docs et versions ; scaffold Next.js + TS strict + Tailwind + shadcn + ESLint/Prettier + Vitest ; `env.ts`, `CLAUDE.md`, `.env.example` | `pnpm dev` OK, contrôles verts |
| 1 | Supabase : migrations, RLS, magic link + allowlist, layout protégé | connexion/déconnexion OK, RLS testée |
| 2 | R2 : client, présignés PUT/GET, script CORS, upload UI | un PDF uploadé apparaît dans R2 |
| 3 | Couche IA : Gemini (texte structuré, TTS, voice design, batch), providers gemini + mock, pricing, usage, estimate, budget | tests unitaires verts, 1 appel réel par fonction en dev |
| 4 | Pipeline Trigger.dev §8 complet + FFmpeg + realtime + reprise | cours mock de bout en bout ; 1 vrai cours de 2 pages en dev |
| 5 | UI : bibliothèque, assistant nouveau cours + estimation, progression, détail cours, réglages/budget | parcours complet utilisable sur mobile |
| 6 | Lecteur §10 complet | checklist §10 validée sur Chrome desktop + Safari iOS |
| 7 | Studio voix + presets (+ clonage P2 si le temps le permet) | voix designée utilisée dans un cours |
| 8 | PWA + hors-ligne | lecture hors-ligne OK (Chrome + Safari iOS) |
| 9 | E2E, durcissement sécurité, CI GitHub Actions (typecheck, lint, unit), README + SETUP + ARCHITECTURE, déploiement | prod en ligne ; 1 vrai cours de 20 pages en Éco, coût réel ≤ estimation + 20 % |

---

## 17. Interdits & pièges connus

- **Hors stack** : pas de backend Python, pas de modèle TTS local, pas de GPU.
- **Texte TTS**
  - Ni didascalie ni markdown : Gemini 3.8 TTS lit le texte mot à mot.
  - Seules les balises `<…>` en anglais sont des événements vocaux.
  - Pas de longue consigne de style (dérive de la voix) : 4 mots maximum.
- **Lecteur**
  - Pas de `<audio loop>` pour l'ambiance.
  - Pas de décodage complet de la voix.
  - Pas de Web Audio sans CORS.
- **Stockage** : pas de Supabase Storage pour l'audio.
- **FFmpeg** : pas de chaîne shell.
- **Coûts**
  - Pas de génération au-delà du budget sans confirmation explicite.
  - Jamais de refacturation : le cache par hash est obligatoire.
  - Tarifs ×2 au 01/01/2027 : tout calcul passe par `pricing.ts` daté.
- **Voix** : pas de clonage d'une voix tierce. Uniquement sa propre voix, avec l'audio de consentement.

---

## 18. Livrables finaux

- Repo complet, tests verts, application déployée (Vercel + Trigger.dev + Supabase + R2).
- `README.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md` (diagramme Mermaid du pipeline), `CLAUDE.md`.
- **Rapport final**
  - ce qui est fait ;
  - les écarts par rapport à la spec et les hypothèses prises ;
  - les coûts mesurés sur un vrai cours ;
  - les prochaines étapes (ex. provider Fish Audio, clonage de voix).

---

## 19. Documentation à lire avant d'implémenter

- **Gemini**
  - https://ai.google.dev/gemini-api/docs/speech-generation
  - https://ai.google.dev/gemini-api/docs/voice-design
  - https://ai.google.dev/gemini-api/docs/voice-replication
  - https://ai.google.dev/gemini-api/docs/batch-api
  - https://ai.google.dev/gemini-api/docs/document-processing
  - https://ai.google.dev/gemini-api/docs/structured-output
  - https://ai.google.dev/gemini-api/docs/thinking
  - https://ai.google.dev/gemini-api/docs/pricing
  - https://ai.google.dev/gemini-api/docs/rate-limits
- **Trigger.dev** : https://trigger.dev/docs — tasks, `wait`, `metadata`, Realtime et React hooks, build extensions (FFmpeg), deploy.
- **Supabase**
  - https://supabase.com/docs/guides/auth/server-side/nextjs
  - https://supabase.com/docs/guides/database/postgres/row-level-security
- **Cloudflare R2**
  - https://developers.cloudflare.com/r2/api/s3/
  - https://developers.cloudflare.com/r2/buckets/cors/
- **Next.js** : https://nextjs.org/docs
- **Serwist** : https://serwist.pages.dev/docs/next
- **MDN** : Web Audio API, Media Session API, `HTMLMediaElement.preservesPitch`, `StorageManager.persist()`.
