import { z } from "zod";

/** Une variable vide dans `.env` vaut « absente ». */
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().min(1).optional(),
);

const emailList = z.preprocess(
  (v) => (typeof v === "string" ? v : ""),
  z.string().transform((raw) =>
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  ),
);

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const optionalPositive = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().positive().optional(),
);

export const ServerEnvSchema = z
  .object({
    APP_ENV: z.enum(["dev", "prod"]).default("dev"),
    AI_MODE: z.enum(["live", "mock"]).default("live"),
    /** `inline` exécute le pipeline dans le process Next (dev, E2E), sans Trigger.dev. */
    JOBS_MODE: z.enum(["trigger", "inline"]).default("trigger"),
    /** `local` stocke les fichiers dans `.data/storage` (dev, E2E), sans R2. */
    STORAGE_MODE: z.enum(["r2", "local"]).default("r2"),
    APP_URL: z.url().default("http://localhost:3000"),

    NEXT_PUBLIC_SUPABASE_URL: optionalString,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
    SUPABASE_SECRET_KEY: optionalString,
    ALLOWED_EMAILS: emailList,
    /** Comptes qui voient `/admin` : tous les cours et toutes les dépenses. Doivent être dans l'allowlist. */
    ADMIN_EMAILS: emailList,

    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL_TEXT: z.string().default("gemini-3.8-flash"),
    GEMINI_MODEL_CHECK: z.string().default("gemini-3.5-flash-lite"),
    GEMINI_MODEL_TTS: z.string().default("gemini-3.8-flash-tts"),
    GEMINI_MODEL_TTS_LITE: z.string().default("gemini-3.8-flash-lite-tts"),

    R2_ACCOUNT_ID: optionalString,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    R2_BUCKET: z.string().default("murmure-audio"),

    TRIGGER_SECRET_KEY: optionalString,
    TRIGGER_PROJECT_REF: optionalString,

    /** Import depuis Google Drive (facultatif) : client OAuth et clé de navigateur, tous deux publics. */
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: optionalString,
    NEXT_PUBLIC_GOOGLE_API_KEY: optionalString,

    /** Budget mensuel donné à chaque nouveau compte (réglable ensuite, 500 $ au plus). */
    MONTHLY_BUDGET_USD: z.coerce.number().positive().max(500).default(10),
    /** Plafond mensuel tous comptes confondus : sans lui, seule la somme des budgets borne la clé Gemini. */
    GLOBAL_MONTHLY_BUDGET_USD: optionalPositive,
    TTS_STANDARD_CONCURRENCY: positiveInt(4),
    MAX_UPLOAD_MB: positiveInt(50),
    MAX_PDF_PAGES: positiveInt(80),
    MAX_SOURCE_CHARS: positiveInt(150_000),
    /** Classeur : gros PDF de plusieurs cours, découpé en leçons (chacune sous les limites ci-dessus). */
    MAX_BINDER_MB: positiveInt(300),
    MAX_BINDER_PAGES: positiveInt(1000),
    DAILY_COURSE_LIMIT: positiveInt(5),
  })
  // Les modes sans clés servent le dev et les E2E : `/api/dev-storage` n'isole pas les comptes.
  .superRefine((value, ctx) => {
    if (value.APP_ENV !== "prod") return;
    const forbidden = [
      value.AI_MODE === "mock" && "AI_MODE=mock",
      value.JOBS_MODE === "inline" && "JOBS_MODE=inline",
      value.STORAGE_MODE === "local" && "STORAGE_MODE=local",
    ].filter((v) => v !== false);
    if (forbidden.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_ENV"],
        message: `APP_ENV=prod interdit ${forbidden.join(", ")}.`,
      });
    }
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export class MissingEnvError extends Error {
  constructor(
    readonly service: string,
    readonly missing: string[],
  ) {
    super(
      `Configuration ${service} incomplète : ${missing.join(", ")} manquant(s). Voir docs/SETUP.md.`,
    );
    this.name = "MissingEnvError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Variables d'environnement invalides :\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Extrait un groupe de variables et garantit qu'elles sont toutes définies. */
export function requireKeys<K extends keyof ServerEnv>(
  env: ServerEnv,
  service: string,
  keys: readonly K[],
): { [P in K]: NonNullable<ServerEnv[P]> } {
  const missing = keys.filter((k) => env[k] === undefined || env[k] === null);
  if (missing.length > 0) throw new MissingEnvError(service, missing.map(String));
  const out = {} as { [P in K]: NonNullable<ServerEnv[P]> };
  for (const k of keys) out[k] = env[k] as NonNullable<ServerEnv[K]>;
  return out;
}
