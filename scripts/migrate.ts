// 데이터베이스 구조를 만들거나 최신으로 올린다. 여러 번 실행해도 안전하다.
// 사용: DATABASE_URL=... npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 필요합니다");

const db = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = path.join(import.meta.dirname, "..", "db", "migrations");

try {
  await db`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await db<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const text = await readFile(path.join(dir, f), "utf8");
    await db.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log(`적용: ${f}`);
  }
  console.log("데이터베이스 구조가 최신입니다.");
} finally {
  await db.end();
}
