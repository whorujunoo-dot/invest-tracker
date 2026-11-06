import Link from "next/link";
import { RecordList } from "./record-list";
import { allTags, listRecords, PAGE_SIZE } from "@/lib/queries";
import { KIND_LABEL } from "@/lib/format";

type Search = { q?: string; kind?: string; tag?: string; before?: string };

function href(base: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  const merged = { ...base, before: undefined, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

export default async function Timeline({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [items, tags] = await Promise.all([listRecords(sp), allTags()]);
  const last = items.at(-1);

  return (
    <main className="block" style={{ gap: 20 }}>
      <form className="search" action="/">
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="검색 — 예: SOXL 금리" aria-label="기록 검색" />
        {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
        {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
        <div className="chips">
          <Link className="chip" aria-current={!sp.kind} href={href(sp, { kind: undefined })}>전체</Link>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <Link key={k} className="chip" aria-current={sp.kind === k} href={href(sp, { kind: k })}>{label}</Link>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="chips">
            {tags.map((t) => (
              <Link key={t.tag} className="chip" aria-current={sp.tag === t.tag}
                href={href(sp, { tag: sp.tag === t.tag ? undefined : t.tag })}>#{t.tag} {t.n}</Link>
            ))}
          </div>
        )}
      </form>

      {items.length === 0 ? (
        <div className="empty">
          {sp.q || sp.kind || sp.tag ? (
            <p>조건에 맞는 기록이 없습니다.</p>
          ) : (
            <>
              <p>아직 기록이 없습니다.</p>
              <p className="muted">텔레그램 봇에게 음성, 글, 사진, 링크를 보내면 여기에 쌓입니다.</p>
            </>
          )}
        </div>
      ) : (
        <RecordList items={items} />
      )}

      {items.length === PAGE_SIZE && last && (
        <div className="more">
          <Link className="btn" href={href(sp, { before: last.occurred_at.toISOString() })}>이전 기록 더 보기</Link>
        </div>
      )}
    </main>
  );
}
