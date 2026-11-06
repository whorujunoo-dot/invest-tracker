"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { audit, sql } from "@/lib/db";
import { runJobs } from "@/lib/jobs";
import { enqueue, refreshSearchText } from "@/lib/records";
import { extractTags } from "@/lib/telegram";

async function guard() {
  if (!(await isSignedIn())) redirect("/login");
}

function id(formData: FormData) {
  const v = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error("잘못된 기록 번호");
  return v;
}

export async function moveToTrash(formData: FormData) {
  await guard();
  const rid = id(formData);
  await sql()`update records set deleted_at = now() where id = ${rid} and deleted_at is null`;
  await audit("web", "trash", rid);
  redirect("/");
}

export async function restoreFromTrash(formData: FormData) {
  await guard();
  const rid = id(formData);
  await sql()`update records set deleted_at = null where id = ${rid}`;
  await audit("web", "restore", rid);
  revalidatePath("/trash");
  redirect(`/r/${rid}`);
}

/** 본문 고치기: 원문은 그대로 두고 새 판을 추가한다 */
export async function saveVersion(formData: FormData) {
  await guard();
  const rid = id(formData);
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  await sql()`insert into record_versions (record_id, body, source) values (${rid}, ${body}, 'user')`;
  await refreshSearchText(rid);
  await audit("web", "edit", rid);
  revalidatePath(`/r/${rid}`);
}

export async function saveTags(formData: FormData) {
  await guard();
  const rid = id(formData);
  const raw = String(formData.get("tags") ?? "");
  const tags = [...new Set([...extractTags(raw), ...raw.split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter((t) => /^[\p{L}\p{N}_]{1,40}$/u.test(t))])];
  await sql()`update records set tags = ${tags} where id = ${rid}`;
  await refreshSearchText(rid);
  await audit("web", "tags", rid, { tags });
  revalidatePath(`/r/${rid}`);
}

export async function toggleAiExcluded(formData: FormData) {
  await guard();
  const rid = id(formData);
  const [r] = await sql()<{ ai_excluded: boolean }[]>`
    update records set ai_excluded = not ai_excluded where id = ${rid} returning ai_excluded`;
  await audit("web", "ai_excluded", rid, { value: r.ai_excluded });
  revalidatePath(`/r/${rid}`);
}

/** 처리 다시 하기: 이전 결과는 남기고 새 결과를 만든다 */
export async function reprocess(formData: FormData) {
  await guard();
  const rid = id(formData);
  const [r] = await sql()<{ kind: string; original_text: string | null }[]>`select kind, original_text from records where id = ${rid}`;
  if (r.kind === "voice") await enqueue(rid, "transcribe");
  if (r.kind === "image") await enqueue(rid, "image_text");
  if (/https?:\/\//.test(r.original_text ?? "")) await enqueue(rid, "link_snapshot");
  await sql()`update records set status = 'pending' where id = ${rid}`;
  await audit("web", "reprocess", rid);
  await runJobs({ recordId: rid, deadlineMs: 45_000 });
  revalidatePath(`/r/${rid}`);
}

export async function addVocabulary(formData: FormData) {
  await guard();
  const term = String(formData.get("term") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!term || term.length > 60) return;
  await sql()`insert into vocabulary (term, note) values (${term}, ${note}) on conflict (term) do update set note = excluded.note`;
  await audit("web", "vocabulary_add", null, { term });
  revalidatePath("/settings");
}

export async function removeVocabulary(formData: FormData) {
  await guard();
  const term = String(formData.get("term") ?? "");
  await sql()`delete from vocabulary where term = ${term}`;
  await audit("web", "vocabulary_remove", null, { term });
  revalidatePath("/settings");
}
