// 복구 검증: 백업을 빈 데이터베이스에 되살린 뒤, 실제 운영 데이터와 대조한다.
//  1) 백업 시점까지의 행 수가 운영 데이터와 같은가
//  2) 원본 고유값(sha256)이 운영 데이터와 같은가
//  3) 백업 저장소의 원본 파일을 무작위로 꺼내 고유값을 다시 계산하면 일치하는가
// 사용: RESTORED_DATABASE_URL=... DATABASE_URL=(운영) MIRROR_REMOTE=b2crypt: npm run verify-restore
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { connect, notify, recordRun } from "./lib";

const run = promisify(execFile);
const restored = connect(process.env.RESTORED_DATABASE_URL);
const prod = connect(process.env.DATABASE_URL);
const mirror = process.env.MIRROR_REMOTE; // 예: "b2crypt:" — 없으면 3)을 건너뜀
const SAMPLE = Number(process.env.SAMPLE_FILES ?? 20);

const problems: string[] = [];
const detail: Record<string, unknown> = {};

try {
  // 시각은 글자 그대로 주고받는다. 자바스크립트 시각은 밀리초까지만 담아서, 날짜로 바꾸면 마지막 기록이 빠진다.
  const [{ cutoff }] = await restored<{ cutoff: string | null }[]>`select max(received_at)::text as cutoff from raw_inputs`;
  detail.cutoff = cutoff;

  if (!cutoff) {
    problems.push("복구된 데이터베이스에 기록이 없습니다");
  } else {
    const checks: [string, string][] = [
      ["raw_inputs", "received_at"],
      ["records", "created_at"],
      ["blobs", "created_at"],
      ["record_files", "created_at"],
      ["record_versions", "created_at"],
    ];
    for (const [table, col] of checks) {
      const [r] = await restored.unsafe(`select count(*)::int as n from ${table} where ${col} <= ($1::text)::timestamptz`, [cutoff]);
      const [p] = await prod.unsafe(`select count(*)::int as n from ${table} where ${col} <= ($1::text)::timestamptz`, [cutoff]);
      detail[table] = { restored: r.n, prod: p.n };
      if (r.n !== p.n) problems.push(`${table}: 복구본 ${r.n}행, 운영 ${p.n}행`);
    }

    const restoredHashes = await restored<{ id: string; payload_sha256: string }[]>`
      select id::text, payload_sha256 from raw_inputs order by id`;
    const prodHashes = new Map(
      (await prod<{ id: string; payload_sha256: string }[]>`
        select id::text, payload_sha256 from raw_inputs where received_at <= (${cutoff}::text)::timestamptz`).map((r) => [r.id, r.payload_sha256]),
    );
    const mismatched = restoredHashes.filter((r) => prodHashes.get(r.id) !== r.payload_sha256).length;
    detail.raw_hash_mismatch = mismatched;
    if (mismatched) problems.push(`원 메시지 고유값 불일치 ${mismatched}건`);
  }

  if (mirror) {
    const sample = await restored<{ sha256: string; storage_key: string }[]>`
      select sha256, storage_key from blobs order by random() limit ${SAMPLE}`;
    let ok = 0;
    for (const b of sample) {
      try {
        const { stdout } = await run("rclone", ["cat", `${mirror}${b.storage_key}`], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
        const h = createHash("sha256").update(stdout).digest("hex");
        if (h === b.sha256) ok++;
        else problems.push(`원본 파일 손상: ${b.storage_key}`);
      } catch {
        problems.push(`백업에 원본 파일 없음: ${b.storage_key}`);
      }
    }
    detail.files_checked = sample.length;
    detail.files_ok = ok;
  }

  const ok = problems.length === 0;
  detail.problems = problems;
  await recordRun(prod, "restore_check", ok, detail);
  await notify(
    ok
      ? `✓ 기록소 월간 복구 검증 통과\n백업 시점: ${detail.cutoff ?? "-"}\n원본 파일 ${detail.files_ok ?? 0}/${detail.files_checked ?? 0}개 확인`
      : `⚠ 기록소 복구 검증 실패\n${problems.slice(0, 10).join("\n")}`,
  );
  console.log(JSON.stringify(detail, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await restored.end();
  await prod.end();
}
