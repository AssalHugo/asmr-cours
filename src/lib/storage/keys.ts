/** Clés du bucket (docs/SPEC.md §7). Tous les identifiants sont des UUID. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (!UUID.test(value))
    throw new Error(`Identifiant invalide dans une clé de stockage : ${value}`);
  return value.toLowerCase();
}

function slug(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(value)) throw new Error(`Nom invalide : ${value}`);
  return value;
}

export const keys = {
  uploadPrefix: (userId: string, courseId: string) => `uploads/${uuid(userId)}/${uuid(courseId)}/`,
  upload: (userId: string, courseId: string, file: string) =>
    `${keys.uploadPrefix(userId, courseId)}${file}`,
  ttsCache: (hash: string) => {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Hash de chunk invalide");
    return `tts-cache/${hash}.wav`;
  },
  coursePrefix: (courseId: string) => `courses/${uuid(courseId)}/`,
  voice: (courseId: string) => `${keys.coursePrefix(courseId)}voice.m4a`,
  mix: (courseId: string, ambience: string) =>
    `${keys.coursePrefix(courseId)}mix-${slug(ambience)}.m4a`,
  chapters: (courseId: string) => `${keys.coursePrefix(courseId)}chapters.json`,
  captions: (courseId: string) => `${keys.coursePrefix(courseId)}captions.json`,
  ambienceMaster: (id: string) => `ambience/master/${slug(id)}.flac`,
  ambienceWeb: (id: string) => `ambience/web/${slug(id)}.m4a`,
  voiceSample: (voiceId: string, mode: "whisper" | "soft") =>
    `voices/${uuid(voiceId)}/sample-${mode}.wav`,
} as const;

/** Nom de fichier normalisé d'un upload : rang (ordre des pages) + UUID + extension sûre. */
export function uploadFileName(index: number, id: string, extension: string): string {
  return `${String(index).padStart(3, "0")}-${uuid(id)}.${slug(extension)}`;
}
