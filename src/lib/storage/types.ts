export type ObjectInfo = { bytes: number; contentType: string | undefined };

export type PresignedPut = { url: string; headers: Record<string, string> };

/** Stockage d'objets : R2 en production, système de fichiers en dev/E2E. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<ObjectInfo | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  uploadFile(path: string, key: string, contentType: string): Promise<void>;
  downloadFile(key: string, path: string): Promise<void>;
  presignPut(
    key: string,
    opts: { contentType: string; bytes: number; expiresIn: number },
  ): Promise<PresignedPut>;
  presignGet(key: string, opts: { expiresIn: number }): Promise<string>;
}

export const PRESIGN_PUT_SECONDS = 15 * 60;
export const PRESIGN_GET_SECONDS = 6 * 60 * 60;
