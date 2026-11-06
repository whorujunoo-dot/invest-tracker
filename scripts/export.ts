// 모든 기록을 열린 형식으로 내보낸다. 이 앱이 사라져도 읽을 수 있게 하기 위해서다.
//  - records/YYYY/MM/*.md : 기록 한 건당 마크다운 파일 하나 (Obsidian 등에서 바로 열림)
//  - data/*.jsonl         : 모든 표의 전체 내용 (다른 시스템으로 옮길 때 사용)
// 원본 파일(음성·사진)은 백업 저장소의 originals/ 폴더에 같은 경로로 있다.
// 사용: DATABASE_URL=... npm run export -- ./export-out
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { connect } from "./lib";

const out = path.resolve(process.argv[2] ?? "export-out");
const tz = process.env.APP_TIME_ZONE ?? "Asia/Seoul";
const db = connect();

const KIND: Record<string, string> = { text: "글", voice: "음성", image: "사진", link: "링크", file: "파일" };

function local(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, y: p.year, m: p.month };
}

function yamlStr(s: string) {
  return JSON.stringify(s);
}

async function dumpTable(name: string) {
  const file = path.join(out, "data", `${name}.jsonl`);
  const ws = createWriteStream(file);
  let n = 0;
  const cursor = db.unsafe(`select * from ${name} order by 1`).cursor(500);
  for await (const rows of cursor) {
    for (const r of rows) { ws.write(JSON.stringify(r) + "\n"); n++; }
  }
  await new Promise<void>((res, rej) => ws.end((e?: Error | null) => (e ? rej(e) : res())));
  return n;
}

try {
  await mkdir(path.join(out, "data"), { recursive: true });
  const counts: Record<string, number> = {};
  for (const t of ["raw_inputs", "blobs", "records", "record_files", "record_versions", "derivations", "vocabulary", "audit_log", "jobs"]) {
    counts[t] = await dumpTable(t);
  }

  const records = await db<{
    id: string; kind: string; occurred_at: Date; original_text: string | null; tags: string[]; deleted_at: Date | null; source_ref: Record<string, unknown>;
  }[]>`select id, kind, occurred_at, original_text, tags, deleted_at, source_ref from records order by occurred_at`;

  for (const r of records) {
    const [files, versions, ders] = await Promise.all([
      db<{ sha256: string; storage_key: string; mime_type: string | null; role: string }[]>`
        select b.sha256, b.storage_key, b.mime_type, rf.role from record_files rf join blobs b on b.sha256 = rf.blob_sha256 where rf.record_id = ${r.id}`,
      db<{ body: string; source: string; created_at: Date }[]>`
        select body, source, created_at from record_versions where record_id = ${r.id} order by created_at, id`,
      db<{ type: string; text: string | null; model: string | null }[]>`
        select type, text, model from derivations where record_id = ${r.id} and superseded_at is null`,
    ]);
    const d = (t: string) => ders.find((x) => x.type === t);
    const l = local(r.occurred_at);

    const front = [
      "---",
      `id: ${r.id}`,
      `kind: ${r.kind}`,
      `occurred_at: ${r.occurred_at.toISOString()}`,
      `tags: [${r.tags.map(yamlStr).join(", ")}]`,
      r.deleted_at ? `deleted_at: ${r.deleted_at.toISOString()}` : null,
      r.source_ref.forwarded ? "forwarded: true" : null,
      files.length ? "files:" : null,
      ...files.map((f) => `  - { role: ${f.role}, sha256: ${f.sha256}, path: ${yamlStr(f.storage_key)}, mime: ${yamlStr(f.mime_type ?? "")} }`),
      "---",
    ].filter((x) => x !== null);

    const sections: string[] = [`# ${l.date} ${l.time} · ${KIND[r.kind] ?? r.kind}`];
    for (const f of files.filter((f) => f.role === "original")) sections.push(`원본 파일: [${path.basename(f.storage_key)}](../../../${f.storage_key})`);
    if (r.original_text) sections.push(`## ${r.kind === "text" || r.kind === "link" ? "원문" : "함께 보낸 글"}\n\n${r.original_text}`);
    if (d("correction")?.text) sections.push(`## 교정본 (자동${d("correction")!.model ? ", " + d("correction")!.model : ""})\n\n${d("correction")!.text}`);
    if (d("transcript")?.text) sections.push(`## 받아쓰기 원문 (자동)\n\n${d("transcript")!.text}`);
    if (d("image_text")?.text) sections.push(`## 이미지 속 글자 (자동)\n\n${d("image_text")!.text}`);
    if (d("link_snapshot")?.text) sections.push(`## 링크 사본 (받은 시점)\n\n${d("link_snapshot")!.text!.slice(0, 5000)}`);
    for (const v of versions) {
      sections.push(`## 고친 본문 · ${v.created_at.toISOString()} · ${v.source === "user" ? "직접 수정" : "텔레그램 수정"}\n\n${v.body}`);
    }

    const dir = path.join(out, "records", l.y, l.m);
    await mkdir(dir, { recursive: true });
    const name = `${l.date}_${l.time.replace(":", "")}_${r.id.slice(0, 8)}.md`;
    await writeFile(path.join(dir, name), front.join("\n") + "\n\n" + sections.join("\n\n") + "\n");
  }

  await writeFile(path.join(out, "README.md"), [
    "# 기록소 내보내기",
    "",
    `만든 시각: ${new Date().toISOString()}`,
    `기록 수: ${records.length}`,
    "",
    "- `records/` 기록 한 건당 마크다운 파일 하나. 위쪽 머리말에 날짜, 태그, 원본 파일 정보가 있습니다.",
    "- `data/` 데이터베이스 모든 표의 전체 내용 (한 줄에 한 행, JSON).",
    "- 음성·사진 원본은 백업 저장소 `originals/` 폴더에 머리말의 path 그대로 있습니다. sha256 값으로 원본이 맞는지 확인할 수 있습니다.",
    "",
    "표별 행 수:",
    ...Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`),
  ].join("\n") + "\n");

  console.log(JSON.stringify({ out, records: records.length, counts }));
} finally {
  await db.end();
}
