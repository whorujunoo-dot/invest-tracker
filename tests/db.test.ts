// 실제 PostgreSQL로 원본 보호 장치와 수집→처리 흐름을 검사한다.
// 실행: TEST_DATABASE_URL=postgres://... npx vitest run tests/db.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const store = new Map<string, Uint8Array>();
const replies: string[] = [];

vi.mock("@/lib/storage", () => ({
  exists: async (k: string) => store.has(k),
  putOnce: async (k: string, b: Uint8Array) => { if (!store.has(k)) store.set(k, b); },
  getBytes: async (k: string) => { const b = store.get(k); if (!b) throw new Error("없음 " + k); return b; },
  signedUrl: async (k: string) => `https://signed/${k}`,
}));
vi.mock("@/lib/telegram", async (orig) => ({
  ...(await orig<typeof import("@/lib/telegram")>()),
  downloadFile: async (id: string) => new TextEncoder().encode(`audio-bytes-${id}`),
  reply: async (_c: unknown, _m: unknown, text: string) => { replies.push(text); },
}));
vi.mock("@/lib/ai/transcribe", () => ({
  transcribe: async () => ({ text: "속셀은 금리 인하 전까지 들고 간다", model: "test-stt" }),
}));
vi.mock("@/lib/ai/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/claude")>();
  return {
    ...real,
    correctTranscript: async (t: string) => {
      const segments = [
        { text: "SOXL", original: "속셀", unsure: false },
        { text: t.slice(2), original: null, unsure: false },
      ];
      return { segments, text: real.joinSegments(segments), verified: real.reconstructsOriginal(segments, t), model: "test-claude" };
    },
  };
});

suite("데이터베이스", () => {
  let db: postgres.Sql;
  const OWNER = 4242;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = postgres(url!, { max: 1, onnotice: () => {} });
    await db`truncate raw_inputs, blobs, records, record_files, record_versions, derivations, jobs, audit_log, vocabulary restart identity cascade`.catch(async () => {
      // 보호 장치 때문에 truncate는 허용된다(행 단위 트리거가 아님). 실패하면 그대로 진행
    });
  });
  afterAll(async () => {
    await db?.end();
    const { sql } = await import("@/lib/db");
    await sql().end();
  });

  const voiceUpdate = (updateId: number, messageId: number, from = OWNER) => ({
    update_id: updateId,
    message: {
      message_id: messageId, date: 1762400000, chat: { id: from, type: "private" }, from: { id: from },
      caption: "#투자", voice: { file_id: `file-${messageId}`, file_unique_id: `u${messageId}`, duration: 75, mime_type: "audio/ogg" },
    },
  });

  it("음성을 받으면 원본을 보관하고 처리 작업을 등록한다", async () => {
    const { ingestUpdate } = await import("@/lib/ingest");
    const r = await ingestUpdate(voiceUpdate(1, 10), OWNER);
    expect(r.status).toBe("saved");
    const [rec] = await db`select * from records`;
    expect(rec.kind).toBe("voice");
    expect(rec.tags).toEqual(["투자"]);
    expect(rec.status).toBe("pending");
    const files = await db`select * from record_files`;
    expect(files).toHaveLength(1);
    const jobs = await db`select type, status from jobs`;
    expect(jobs).toEqual([{ type: "transcribe", status: "queued" }]);
    expect([...store.keys()].some((k) => k.startsWith("raw/telegram/"))).toBe(true);
    expect([...store.keys()].some((k) => k.startsWith("originals/"))).toBe(true);
  });

  it("같은 메시지가 다시 오면 중복 저장하지 않는다", async () => {
    const { ingestUpdate } = await import("@/lib/ingest");
    expect((await ingestUpdate(voiceUpdate(1, 10), OWNER)).status).toBe("duplicate");
    expect((await db`select count(*)::int n from records`)[0].n).toBe(1);
  });

  it("본인이 아니면 저장하지 않는다", async () => {
    const { ingestUpdate } = await import("@/lib/ingest");
    expect((await ingestUpdate(voiceUpdate(2, 11, 999), OWNER)).status).toBe("ignored");
    expect((await db`select count(*)::int n from raw_inputs`)[0].n).toBe(1);
  });

  it("받아쓰기 → 교정까지 처리하고 검색에 반영한다", async () => {
    const { runJobs } = await import("@/lib/jobs");
    await runJobs({});
    const ders = await db`select type, text, content from derivations where superseded_at is null order by type`;
    expect(ders.map((d) => d.type)).toEqual(["correction", "transcript"]);
    expect(ders[0].text).toBe("SOXL은 금리 인하 전까지 들고 간다");
    expect(ders[0].content.verified).toBe(true);
    const [rec] = await db`select status, search_text from records`;
    expect(rec.status).toBe("ready");
    expect(rec.search_text).toContain("SOXL");
    expect(rec.search_text).toContain("속셀"); // 받아쓰기 원문으로도 찾을 수 있다
    expect(replies.at(-1)).toContain("SOXL은");

    const { listRecords } = await import("@/lib/queries");
    const found = await listRecords({ q: "soxl 금리" });
    expect(found).toHaveLength(1);
    expect(found[0].body).toBe("SOXL은 금리 인하 전까지 들고 간다");
    expect(await listRecords({ q: "없는단어" })).toHaveLength(0);
  });

  it("텔레그램에서 고친 메시지는 새 판으로 쌓인다", async () => {
    const { ingestUpdate } = await import("@/lib/ingest");
    const u = voiceUpdate(3, 10);
    const r = await ingestUpdate({ update_id: 3, edited_message: { ...u.message, caption: "#투자 #반도체", edit_date: 1762400100 } }, OWNER);
    expect(r.status).toBe("edited");
    expect((await db`select count(*)::int n from record_versions`)[0].n).toBe(1);
  });

  it("원본은 수정·삭제할 수 없다", async () => {
    await expect(db`update raw_inputs set payload = '{}'`).rejects.toThrow(/수정하거나 삭제할 수 없습니다/);
    await expect(db`delete from raw_inputs`).rejects.toThrow();
    await expect(db`update blobs set size_bytes = 0`).rejects.toThrow();
    await expect(db`update records set original_text = '바꿈'`).rejects.toThrow(/원문 정보는 바꿀 수 없습니다/);
    await expect(db`delete from records`).rejects.toThrow(/휴지통/);
    await expect(db`update derivations set text = '바꿈'`).rejects.toThrow(/수정할 수 없습니다/);
    await expect(db`delete from record_versions`).rejects.toThrow();
  });

  it("태그·휴지통·처리 결과 교체는 허용된다", async () => {
    await db`update records set tags = '{사업}', deleted_at = now()`;
    await db`update records set deleted_at = null`;
    await db`update derivations set superseded_at = now() where type = 'transcript'`;
    const [r] = await db`select tags from records`;
    expect(r.tags).toEqual(["사업"]);
  });

  it("완전 삭제는 명시적으로 허용했을 때만 된다", async () => {
    await db.begin(async (tx) => {
      await tx`select set_config('girokso.allow_purge', 'on', true)`;
      await tx`delete from jobs`;
      await tx`delete from derivations`;
      await tx`delete from record_versions`;
      await tx`delete from record_files`;
      await tx`delete from records`;
    });
    expect((await db`select count(*)::int n from records`)[0].n).toBe(0);
    // 트랜잭션이 끝나면 다시 잠긴다
    await expect(db`delete from raw_inputs`).rejects.toThrow();
  });
});
