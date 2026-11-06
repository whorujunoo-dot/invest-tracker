import postgres from "postgres";
import { env } from "./env";

// 표준 PostgreSQL 연결. Supabase가 아닌 다른 PostgreSQL로 옮겨도 그대로 동작한다.
declare global {
  // eslint-disable-next-line no-var
  var __girokso_sql: postgres.Sql | undefined;
}

export function sql(): postgres.Sql {
  if (!globalThis.__girokso_sql) {
    globalThis.__girokso_sql = postgres(env.databaseUrl, {
      max: 3,
      prepare: false, // Supabase 연결 풀(트랜잭션 방식)과 호환
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return globalThis.__girokso_sql;
}

export async function audit(
  actor: string,
  action: string,
  recordId: string | null,
  detail: Record<string, unknown> = {},
) {
  await sql()`insert into audit_log (actor, action, record_id, detail)
    values (${actor}, ${action}, ${recordId}, ${sql().json(detail as postgres.JSONValue)})`;
}
