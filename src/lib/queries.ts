import { sql } from "./db";
import type { CorrectionSegment } from "./ai/claude";

export type ListItem = {
  id: string;
  kind: string;
  occurred_at: Date;
  tags: string[];
  status: string;
  body: string | null;
  duration: number | null;
  has_unsure: boolean;
};

export type ListFilter = { q?: string; kind?: string; tag?: string; before?: string; trash?: boolean };

export const PAGE_SIZE = 50;

/** 기록 목록. 보여줄 본문은 '직접 고친 판 → 교정본 → 원문 → 받아쓰기 → 이미지 글자' 순으로 고른다. */
export async function listRecords(f: ListFilter): Promise<ListItem[]> {
  const db = sql();
  const words = (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const before = f.before ? new Date(f.before) : null;

  return db<ListItem[]>`
    select r.id, r.kind, r.occurred_at, r.tags, r.status,
      coalesce(
        (select body from record_versions v where v.record_id = r.id order by created_at desc, id desc limit 1),
        (select text from derivations d where d.record_id = r.id and d.type = 'correction' and d.superseded_at is null),
        nullif(r.original_text, ''),
        (select text from derivations d where d.record_id = r.id and d.type = 'transcript' and d.superseded_at is null),
        (select text from derivations d where d.record_id = r.id and d.type in ('image_text','link_snapshot') and d.superseded_at is null limit 1)
      ) as body,
      (select (rf.meta->>'duration')::int from record_files rf where rf.record_id = r.id and rf.role = 'original' limit 1) as duration,
      exists (select 1 from derivations d where d.record_id = r.id and d.type = 'correction' and d.superseded_at is null
        and (d.content->>'verified' = 'false' or d.content->'segments' @> '[{"unsure": true}]')) as has_unsure
    from records r
    where ${f.trash ? db`r.deleted_at is not null` : db`r.deleted_at is null`}
      ${f.kind ? db`and r.kind = ${f.kind}` : db``}
      ${f.tag ? db`and ${f.tag} = any(r.tags)` : db``}
      ${before && !isNaN(before.getTime()) ? db`and r.occurred_at < ${before}` : db``}
      ${words.reduce((acc, w) => db`${acc} and r.search_text ilike ${"%" + w.replace(/[\\%_]/g, "\\$&") + "%"}`, db``)}
    order by r.occurred_at desc
    limit ${PAGE_SIZE}`;
}

export type RecordDetail = {
  id: string;
  kind: string;
  occurred_at: Date;
  created_at: Date;
  original_text: string | null;
  source_ref: Record<string, unknown>;
  tags: string[];
  status: string;
  ai_excluded: boolean;
  deleted_at: Date | null;
  raw_input_id: string | null;
};

export async function getRecord(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = sql();
  const [rec] = await db<RecordDetail[]>`select * from records where id = ${id}`;
  if (!rec) return null;
  const [files, versions, derivations, jobs, history] = await Promise.all([
    db<{ blob_sha256: string; role: string; meta: Record<string, unknown>; mime_type: string | null; size_bytes: string }[]>`
      select rf.blob_sha256, rf.role, rf.meta, b.mime_type, b.size_bytes
      from record_files rf join blobs b on b.sha256 = rf.blob_sha256 where rf.record_id = ${id} order by rf.created_at`,
    db<{ id: string; body: string; source: string; created_at: Date }[]>`
      select id, body, source, created_at from record_versions where record_id = ${id} order by created_at desc, id desc`,
    db<{ id: string; type: string; text: string | null; content: Record<string, unknown>; model: string | null; prompt_version: string | null; created_at: Date; superseded_at: Date | null }[]>`
      select * from derivations where record_id = ${id} order by created_at desc`,
    db<{ type: string; status: string; attempts: number; last_error: string | null }[]>`
      select type, status, attempts, last_error from jobs where record_id = ${id} order by id`,
    db<{ at: Date; actor: string; action: string; detail: Record<string, unknown> }[]>`
      select at, actor, action, detail from audit_log where record_id = ${id} order by at desc limit 30`,
  ]);
  const current = (t: string) => derivations.find((d) => d.type === t && !d.superseded_at) ?? null;
  const correction = current("correction");
  return {
    rec, files, versions, jobs, history,
    derivations,
    transcript: current("transcript"),
    correction: correction
      ? { ...correction, segments: (correction.content.segments ?? []) as CorrectionSegment[], verified: correction.content.verified !== false }
      : null,
    imageText: current("image_text"),
    link: current("link_snapshot"),
  };
}

export async function allTags(): Promise<{ tag: string; n: number }[]> {
  return sql()<{ tag: string; n: number }[]>`
    select tag, count(*)::int as n from records, unnest(tags) as tag
    where deleted_at is null group by tag order by n desc, tag limit 60`;
}

export async function stats() {
  const [s] = await sql()<{ records: number; trash: number; blobs: number; bytes: string; failed_jobs: number; pending_jobs: number }[]>`
    select
      (select count(*)::int from records where deleted_at is null) as records,
      (select count(*)::int from records where deleted_at is not null) as trash,
      (select count(*)::int from blobs) as blobs,
      (select coalesce(sum(size_bytes),0)::text from blobs) as bytes,
      (select count(*)::int from jobs where status = 'failed') as failed_jobs,
      (select count(*)::int from jobs where status in ('queued','running')) as pending_jobs`;
  const runs = await sql()<{ kind: string; ok: boolean; detail: Record<string, unknown>; started_at: Date }[]>`
    select distinct on (kind) kind, ok, detail, started_at from maintenance_runs order by kind, started_at desc`;
  return { ...s, runs };
}
