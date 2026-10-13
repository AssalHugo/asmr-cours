import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Env } from "@/lib/env";
import type { ObjectStorage } from "@/lib/storage/types";

let cached: { client: S3Client; bucket: string } | undefined;

export function r2(): { client: S3Client; bucket: string } {
  if (!cached) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = r2Env();
    cached = {
      bucket: R2_BUCKET,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
        // R2 n'implémente pas les checksums CRC32 ajoutés par défaut par le SDK v3,
        // et ils casseraient les PUT présignés envoyés par le navigateur.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    };
  }
  return cached;
}

export function createR2Storage(): ObjectStorage {
  const { client, bucket } = r2();

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error(`Objet vide : ${key}`);
      return Buffer.from(await res.Body.transformToByteArray());
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (error) {
        if (error instanceof NotFound) return null;
        throw error;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (objects.length > 0) {
          await client.send(
            new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
          );
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },

    async uploadFile(path, key, contentType) {
      const { size } = await stat(path);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: size,
          ContentType: contentType,
        }),
      );
    },

    async downloadFile(key, path) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!(res.Body instanceof Readable)) throw new Error(`Objet illisible : ${key}`);
      await pipeline(res.Body, createWriteStream(path));
    },

    async presignPut(key, { contentType, bytes, expiresIn }) {
      // Content-Type et Content-Length sont signés : un autre type ou une autre taille → 403.
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: bytes,
        }),
        { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
      );
      return { url, headers: { "Content-Type": contentType } };
    },

    presignGet(key, { expiresIn }) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn,
      });
    },
  };
}
