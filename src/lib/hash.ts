import { createHash } from "node:crypto";

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

const EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "text/html": "html",
  "application/json": "json",
};

export function extFor(mime: string | null | undefined, fallbackName?: string): string {
  if (mime && EXT[mime]) return EXT[mime];
  const m = fallbackName?.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : "bin";
}

/** 원본 파일 경로: originals/2026/11/<sha256>.<확장자> — 같은 파일은 한 번만 저장된다 */
export function blobKey(hash: string, ext: string, at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `originals/${y}/${m}/${hash}.${ext}`;
}

export function rawKey(source: string, externalId: string, at: Date): string {
  const d = at.toISOString().slice(0, 10).replaceAll("-", "/");
  return `raw/${source}/${d}/${externalId}.json`;
}
