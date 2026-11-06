import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

// Cloudflare R2는 업계 표준(S3) 방식이라, 다른 저장소로 옮길 때도 이 파일만 바꾸면 된다.
let client: S3Client | undefined;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey },
    });
  }
  return client;
}

export async function exists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: env.r2Bucket, Key: key }));
    return true;
  } catch (e: unknown) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw e;
  }
}

/** 이미 있는 파일은 덮어쓰지 않는다 (원본 보호) */
export async function putOnce(key: string, body: Uint8Array, contentType?: string, sha?: string) {
  if (await exists(key)) return;
  await s3().send(
    new PutObjectCommand({
      Bucket: env.r2Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: sha ? { sha256: sha } : undefined,
    }),
  );
}

export async function getBytes(key: string): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }));
  if (!res.Body) throw new Error(`저장소에서 ${key} 를 읽지 못했습니다`);
  return await res.Body.transformToByteArray();
}

export async function signedUrl(key: string, seconds = 600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }), {
    expiresIn: seconds,
  });
}
