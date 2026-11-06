import type postgres from "postgres";
import { sql } from "./db";
import { blobKey, extFor, sha256 } from "./hash";
import { putOnce } from "./storage";

type Tx = postgres.TransactionSql | postgres.Sql;

/** 파일을 원본 저장소에 넣고 blobs 표에 등록한다. 같은 내용이면 한 번만 저장된다. */
export async function storeBlob(
  bytes: Uint8Array,
  mime: string | null,
  name?: string,
  db: Tx = sql(),
): Promise<{ sha: string; key: string }> {
  const sha = sha256(bytes);
  const key = blobKey(sha, extFor(mime, name), new Date());
  const [existing] = await db<{ storage_key: string }[]>`
    select storage_key from blobs where sha256 = ${sha}`;
  if (existing) return { sha, key: existing.storage_key };
  await putOnce(key, bytes, mime ?? undefined, sha);
  await db`insert into blobs (sha256, storage_key, mime_type, size_bytes)
    values (${sha}, ${key}, ${mime}, ${bytes.byteLength})
    on conflict (sha256) do nothing`;
  return { sha, key };
}

/** 검색용 글 묶음을 다시 만든다. 원문 + 최신 본문 + 현재 처리 결과 */
export async function refreshSearchText(recordId: string, db: Tx = sql()) {
  await db`
    update records r set search_text = left(concat_ws(E'\n',
      r.original_text,
      (select body from record_versions v where v.record_id = r.id order by created_at desc, id desc limit 1),
      (select string_agg(d.text, E'\n' order by d.type) from derivations d
        where d.record_id = r.id and d.superseded_at is null and d.text is not null),
      array_to_string(r.tags, ' ')
    ), 200000)
    where r.id = ${recordId}`;
}

/** 새 처리 결과를 추가하고, 같은 종류의 이전 결과는 '이전 판'으로 표시한다 */
export async function addDerivation(
  recordId: string,
  type: "transcript" | "correction" | "image_text" | "link_snapshot",
  text: string | null,
  content: Record<string, unknown>,
  model: string | null,
  promptVersion: string | null,
) {
  await sql().begin(async (tx) => {
    await tx`update derivations set superseded_at = now()
      where record_id = ${recordId} and type = ${type} and superseded_at is null`;
    await tx`insert into derivations (record_id, type, text, content, model, prompt_version)
      values (${recordId}, ${type}, ${text}, ${tx.json(content as postgres.JSONValue)}, ${model}, ${promptVersion})`;
    await refreshSearchText(recordId, tx);
  });
}

export async function enqueue(
  recordId: string,
  type: "fetch_file" | "transcribe" | "correct" | "image_text" | "link_snapshot",
  db: Tx = sql(),
) {
  await db`insert into jobs (record_id, type) values (${recordId}, ${type})`;
}
