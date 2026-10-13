/**
 * Applique la politique CORS du bucket R2 (docs/SPEC.md §7).
 * Usage : pnpm r2:cors [origine supplémentaire…]
 * Sans CORS, Web Audio lit du silence sur un <audio crossorigin="anonymous">.
 */
import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { r2 } from "@/lib/r2";

async function main() {
  const origins = [
    ...new Set([env().APP_URL, "http://localhost:3000", ...process.argv.slice(2)].map(originOf)),
  ];
  const { client, bucket } = r2();

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["Range", "Content-Type"],
            ExposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );

  const applied = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(`CORS appliqué sur « ${bucket} » :`);
  console.log(JSON.stringify(applied.CORSRules, null, 2));
  console.log("La propagation peut prendre jusqu'à 30 secondes.");
}

function originOf(value: string): string {
  return new URL(value).origin;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
