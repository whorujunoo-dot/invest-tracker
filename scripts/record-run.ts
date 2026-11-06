// 백업 작업이 끝난 뒤 결과를 기록하고 알린다.
// 사용: npm exec tsx scripts/record-run.ts -- backup ok '{"size":"..."}'
import { connect, notify, recordRun } from "./lib";

const [kind, status, json] = process.argv.slice(2);
if (kind !== "backup" && kind !== "export") throw new Error("kind는 backup 또는 export");
const ok = status === "ok";
const detail = json ? JSON.parse(json) : {};

const db = connect();
try {
  await recordRun(db, kind, ok, detail);
  if (!ok) await notify(`⚠ 기록소 ${kind === "backup" ? "매일 백업" : "월간 내보내기"} 실패. GitHub Actions 기록을 확인해 주세요.`);
} finally {
  await db.end();
}
