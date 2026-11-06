import { audit, sql } from "./db";
import { correctTranscript, CORRECTION_PROMPT_VERSION, IMAGE_PROMPT_VERSION, isTrivialChange, readImage, RefusedError } from "./ai/claude";
import { transcribe } from "./ai/transcribe";
import { snapshot } from "./link";
import { addDerivation, enqueue, storeBlob } from "./records";
import { getBytes } from "./storage";
import { downloadFile, reply, type TgMessage } from "./telegram";

const MAX_ATTEMPTS = 6;

type Job = { id: string; record_id: string; type: string; attempts: number };

type RecordRow = {
  id: string;
  kind: string;
  original_text: string | null;
  source_ref: { chat_id?: string; message_id?: string };
  ai_excluded: boolean;
  raw_input_id: string | null;
};

async function originalFile(recordId: string) {
  const [f] = await sql()<{ storage_key: string; mime_type: string | null }[]>`
    select b.storage_key, b.mime_type from record_files rf join blobs b on b.sha256 = rf.blob_sha256
    where rf.record_id = ${recordId} and rf.role = 'original' limit 1`;
  return f;
}

async function vocabulary(): Promise<string[]> {
  const rows = await sql()<{ term: string }[]>`select term from vocabulary order by term`;
  return rows.map((r) => r.term);
}

async function runOne(job: Job, rec: RecordRow) {
  switch (job.type) {
    case "fetch_file": {
      if (await originalFile(rec.id)) return;
      const [raw] = await sql()<{ payload: { message?: TgMessage } }[]>`
        select payload from raw_inputs where id = ${rec.raw_input_id}`;
      const m = raw?.payload.message;
      const f = m?.voice ?? m?.audio ?? m?.video_note ?? m?.document ?? m?.video ??
        (m?.photo ? [...m.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0] : undefined);
      if (!f) throw new Error("원 메시지에서 파일 정보를 찾지 못했습니다");
      const mime = f.mime_type ?? (m?.photo ? "image/jpeg" : null);
      const blob = await storeBlob(await downloadFile(f.file_id), mime, f.file_name);
      await sql()`insert into record_files (record_id, blob_sha256, role, meta)
        values (${rec.id}, ${blob.sha}, 'original', ${sql().json({ telegram_file_unique_id: f.file_unique_id, duration: f.duration ?? null })})
        on conflict do nothing`;
      if (rec.kind === "voice") await enqueue(rec.id, "transcribe");
      if (rec.kind === "image") await enqueue(rec.id, "image_text");
      return;
    }

    case "transcribe": {
      const f = await originalFile(rec.id);
      if (!f) throw new Error("원본 음성 파일이 아직 없습니다");
      const audio = await getBytes(f.storage_key);
      const vocab = await vocabulary();
      const t = await transcribe(audio, f.mime_type ?? "audio/ogg", vocab);
      await addDerivation(rec.id, "transcript", t.text, { language: "ko" }, t.model, null);
      if (t.text && !rec.ai_excluded) await enqueue(rec.id, "correct");
      else if (rec.source_ref.chat_id) {
        await reply(rec.source_ref.chat_id, rec.source_ref.message_id!, `📝 받아쓰기\n${t.text || "(인식된 말이 없습니다)"}`);
      }
      return;
    }

    case "correct": {
      if (rec.ai_excluded) return;
      const [tr] = await sql()<{ text: string }[]>`
        select text from derivations where record_id = ${rec.id} and type = 'transcript' and superseded_at is null`;
      if (!tr?.text) throw new Error("받아쓰기 원문이 없습니다");
      const vocab = await vocabulary();
      let result = await correctTranscript(tr.text, vocab);
      if (!result.verified) result = await correctTranscript(tr.text, vocab); // 한 번 더 시도
      await addDerivation(
        rec.id, "correction", result.text,
        { segments: result.segments, verified: result.verified },
        result.model, CORRECTION_PROMPT_VERSION,
      );
      if (rec.source_ref.chat_id) {
        const changes = result.segments.filter((s) => !isTrivialChange(s)).length;
        const unsure = result.segments.filter((s) => s.unsure).length;
        const note = !result.verified
          ? "\n⚠ 교정 내용을 원문과 대조하지 못했습니다. 웹에서 원문을 확인해 주세요."
          : changes ? `\n(고친 곳 ${changes}군데${unsure ? `, 확인 필요 ${unsure}군데` : ""})` : "";
        await reply(rec.source_ref.chat_id, rec.source_ref.message_id!, `📝 ${result.text}${note}`);
      }
      return;
    }

    case "image_text": {
      if (rec.ai_excluded) return;
      const f = await originalFile(rec.id);
      if (!f) throw new Error("원본 이미지가 아직 없습니다");
      const img = await readImage(await getBytes(f.storage_key), f.mime_type ?? "image/jpeg");
      const text = [img.text_in_image, img.description].filter(Boolean).join("\n\n");
      await addDerivation(rec.id, "image_text", text, img, img.model, IMAGE_PROMPT_VERSION);
      return;
    }

    case "link_snapshot": {
      const urls = [...(rec.original_text ?? "").matchAll(/https?:\/\/[^\s<>"'）)]+/g)]
        .map((m) => m[0].replace(/[.,!?]+$/, ""))
        .slice(0, 3);
      const results = [];
      for (const url of urls) {
        try {
          const s = await snapshot(url);
          const blob = await storeBlob(s.bytes, s.contentType.split(";")[0], undefined);
          await sql()`insert into record_files (record_id, blob_sha256, role, meta)
            values (${rec.id}, ${blob.sha}, 'snapshot', ${sql().json({ url, final_url: s.finalUrl, status: s.status })})
            on conflict do nothing`;
          results.push({ url, final_url: s.finalUrl, status: s.status, title: s.title, sha256: blob.sha, text: s.text.slice(0, 20000) });
        } catch (e) {
          results.push({ url, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const text = results.map((r) => ["title" in r ? r.title : null, "text" in r ? r.text : null].filter(Boolean).join("\n")).join("\n\n");
      await addDerivation(rec.id, "link_snapshot", text || null, { pages: results }, null, null);
      return;
    }

    default:
      throw new Error(`알 수 없는 작업 ${job.type}`);
  }
}

async function settleRecordStatus(recordId: string) {
  await sql()`
    with s as (
      select case
        when exists (select 1 from jobs where record_id = ${recordId} and status in ('queued','running')) then 'pending'
        when exists (select 1 from jobs where record_id = ${recordId} and status = 'failed') then 'partial'
        else 'ready' end as st)
    update records r set status = s.st from s
    where r.id = ${recordId} and r.status is distinct from s.st`;
}

/**
 * 대기 중인 작업을 처리한다. 여러 곳에서 동시에 불러도 같은 작업을 두 번 하지 않는다.
 * recordId를 주면 그 기록의 작업만, 없으면 밀린 작업 전체를 처리한다.
 */
export async function runJobs(opts: { recordId?: string; limit?: number; deadlineMs?: number } = {}) {
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  let processed = 0;
  const touched = new Set<string>();

  while (processed < (opts.limit ?? 50) && Date.now() < deadline) {
    const [job] = await sql()<Job[]>`
      update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
      where id = (
        select id from jobs
        where (status = 'queued' or (status = 'running' and updated_at < now() - interval '10 minutes'))
          and run_after <= now()
          ${opts.recordId ? sql()`and record_id = ${opts.recordId}` : sql()``}
        order by id
        for update skip locked
        limit 1
      )
      returning id, record_id, type, attempts`;
    if (!job) break;
    processed++;
    touched.add(job.record_id);

    const [rec] = await sql()<RecordRow[]>`
      select id, kind, original_text, source_ref, ai_excluded, raw_input_id from records where id = ${job.record_id}`;
    try {
      await runOne(job, rec);
      await sql()`update jobs set status = 'done', last_error = null, updated_at = now() where id = ${job.id}`;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const final = e instanceof RefusedError || job.attempts >= MAX_ATTEMPTS;
      // 실패할수록 간격을 늘려 다시 시도: 2분, 4분, 8분 …
      const delayMin = 2 ** job.attempts;
      await sql()`update jobs set
          status = ${final ? "failed" : "queued"},
          last_error = ${message.slice(0, 2000)},
          run_after = now() + make_interval(mins => ${delayMin}),
          updated_at = now()
        where id = ${job.id}`;
      await audit("system", final ? "job_failed" : "job_retry", job.record_id, { job: job.type, error: message.slice(0, 500) });
    }
  }

  for (const id of touched) await settleRecordStatus(id);
  return { processed };
}
