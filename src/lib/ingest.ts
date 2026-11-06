import type postgres from "postgres";
import { audit, sql } from "./db";
import { rawKey, sha256 } from "./hash";
import { enqueue, refreshSearchText, storeBlob } from "./records";
import { putOnce } from "./storage";
import {
  downloadFile,
  parseMessage,
  TELEGRAM_FILE_LIMIT,
  type ParsedInput,
  type TgUpdate,
} from "./telegram";

export type IngestResult =
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  | { status: "edited"; recordId: string }
  | { status: "saved"; recordId: string; parsed: ParsedInput; fileError?: string };

/**
 * 텔레그램 메시지를 받는 즉시 처리하는 단계.
 * 하는 일은 '원본 보관'뿐이다. AI 처리는 이후 대기열에서 따로 한다.
 */
export async function ingestUpdate(update: TgUpdate, ownerId: number): Promise<IngestResult> {
  const msg = update.message ?? update.edited_message;
  if (!msg) return { status: "ignored", reason: "지원하지 않는 형식" };
  if (msg.from?.id !== ownerId) return { status: "ignored", reason: "본인이 아닌 사용자" };

  // 1) 원 메시지를 저장소와 데이터베이스 두 곳에 그대로 보관
  const payload = JSON.stringify(update);
  const payloadSha = sha256(payload);
  const externalId = String(update.update_id);
  const key = rawKey("telegram", externalId, new Date(msg.date * 1000));
  await putOnce(key, new TextEncoder().encode(payload), "application/json", payloadSha);

  const [raw] = await sql()<{ id: string }[]>`
    insert into raw_inputs (source, external_id, payload, payload_sha256, storage_key)
    values ('telegram', ${externalId}, ${sql().json(update as unknown as postgres.JSONValue)}, ${payloadSha}, ${key})
    on conflict (source, external_id) do nothing
    returning id`;
  if (!raw) return { status: "duplicate" }; // 텔레그램이 같은 메시지를 다시 보낸 경우

  // 2) 수정된 메시지는 이전 판을 남기고 새 판으로 추가
  if (update.edited_message) {
    const [rec] = await sql()<{ id: string }[]>`
      select id from records
      where source_ref->>'chat_id' = ${String(msg.chat.id)}
        and source_ref->>'message_id' = ${String(msg.message_id)}`;
    if (!rec) return { status: "ignored", reason: "원래 기록을 찾지 못함" };
    const body = msg.text ?? msg.caption ?? "";
    await sql()`insert into record_versions (record_id, body, source)
      values (${rec.id}, ${body}, 'telegram_edit')`;
    await refreshSearchText(rec.id);
    await audit("telegram", "edit", rec.id, { raw_input_id: raw.id });
    return { status: "edited", recordId: rec.id };
  }

  const parsed = parseMessage(msg);
  if (!parsed) return { status: "ignored", reason: "내용이 없는 메시지" };

  // 3) 첨부 파일은 지금 바로 내려받는다. 텔레그램 서버를 저장소로 믿지 않는다.
  let blob: { sha: string; key: string } | null = null;
  let fileError: string | undefined;
  if (parsed.file) {
    if ((parsed.file.file_size ?? 0) > TELEGRAM_FILE_LIMIT) {
      fileError = "20MB를 넘는 파일은 봇이 내려받을 수 없습니다";
    } else {
      try {
        const bytes = await downloadFile(parsed.file.file_id);
        blob = await storeBlob(bytes, parsed.file.mime_type ?? null, parsed.file.file_name);
      } catch (e) {
        fileError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  // 4) 기록과 처리 작업을 한 번에 등록
  const recordId = await sql().begin(async (tx) => {
    const [rec] = await tx<{ id: string }[]>`
      insert into records (raw_input_id, kind, occurred_at, original_text, source_ref, tags, status)
      values (${raw.id}, ${parsed.kind}, ${parsed.occurredAt}, ${parsed.text},
              ${tx.json(parsed.sourceRef)}, ${parsed.tags},
              ${parsed.file || parsed.urls.length ? "pending" : "ready"})
      returning id`;

    if (blob && parsed.file) {
      await tx`insert into record_files (record_id, blob_sha256, role, meta)
        values (${rec.id}, ${blob.sha}, 'original', ${tx.json({
          telegram_file_unique_id: parsed.file.file_unique_id,
          duration: parsed.file.duration ?? null,
          file_name: parsed.file.file_name ?? null,
        })})`;
    }

    if (parsed.file && !blob && !fileError?.startsWith("20MB")) await enqueue(rec.id, "fetch_file", tx);
    if (parsed.kind === "voice" && blob) await enqueue(rec.id, "transcribe", tx);
    if (parsed.kind === "image" && blob) await enqueue(rec.id, "image_text", tx);
    if (parsed.urls.length) await enqueue(rec.id, "link_snapshot", tx);

    await refreshSearchText(rec.id, tx);
    return rec.id;
  });

  await audit("telegram", "create", recordId, { kind: parsed.kind, file_error: fileError ?? null });
  return { status: "saved", recordId, parsed, fileError };
}

export function receiptText(r: Extract<IngestResult, { status: "saved" }>): string {
  const p = r.parsed;
  const label = { text: "글", voice: "음성", image: "사진", link: "링크", file: "파일" }[p.kind];
  const dur = p.file?.duration ? ` ${Math.floor(p.file.duration / 60)}:${String(p.file.duration % 60).padStart(2, "0")}` : "";
  const tags = p.tags.length ? ` · ${p.tags.map((t) => "#" + t).join(" ")}` : "";
  const next = p.kind === "voice" ? "\n받아쓰기와 교정이 끝나면 다시 알려드립니다." : "";
  const warn = !r.fileError
    ? ""
    : r.fileError.startsWith("20MB")
      ? `\n⚠ ${r.fileError}. 메시지 정보만 저장됐습니다. 파일을 나눠서 보내 주세요.`
      : `\n⚠ 파일 보관 실패: ${r.fileError}. 메시지는 저장됐고 파일은 자동으로 다시 내려받습니다.`;
  return `✓ 저장됨 (${label}${dur})${tags}${next}${warn}`;
}
