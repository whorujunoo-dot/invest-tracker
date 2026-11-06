// 백업·내보내기·복구 검증 스크립트가 함께 쓰는 도구
import postgres from "postgres";

export function connect(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL 이 필요합니다");
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

export async function recordRun(
  db: postgres.Sql,
  kind: "backup" | "restore_check" | "export",
  ok: boolean,
  detail: Record<string, unknown>,
) {
  await db`insert into maintenance_runs (kind, ok, detail) values (${kind}, ${ok}, ${db.json(detail as postgres.JSONValue)})`;
}

/** 결과를 텔레그램으로 알린다. 토큰이 없으면 조용히 넘어간다. */
export async function notify(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_OWNER_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch(() => {});
}
