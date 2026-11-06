import Link from "next/link";
import type { ListItem } from "@/lib/queries";
import { dayKey, dayLabel, duration, KIND_LABEL, timeLabel } from "@/lib/format";

export function RecordList({ items }: { items: ListItem[] }) {
  const days: { key: string; label: string; items: ListItem[] }[] = [];
  for (const it of items) {
    const key = dayKey(it.occurred_at);
    if (days.at(-1)?.key !== key) days.push({ key, label: dayLabel(it.occurred_at), items: [] });
    days.at(-1)!.items.push(it);
  }

  return (
    <div className="block" style={{ gap: 8 }}>
      {days.map((d) => (
        <section key={d.key} className="day">
          <div className="day-head">{d.label}</div>
          {d.items.map((it) => (
            <Link key={it.id} href={`/r/${it.id}`} className="item">
              <span className="tm">{timeLabel(it.occurred_at)}</span>
              <div style={{ minWidth: 0 }}>
                <div className={`tx ${it.body ? "" : "pending"}`}>
                  {it.body ?? (it.status === "pending" ? "처리 중…" : "(내용 없음)")}
                </div>
                <div className="meta">
                  <span>{KIND_LABEL[it.kind]}{it.duration ? ` ${duration(it.duration)}` : ""}</span>
                  {it.tags.map((t) => <span key={t}>#{t}</span>)}
                  {it.has_unsure && <span className="bad">교정 확인 필요</span>}
                  {it.status === "partial" && <span className="bad">일부 처리 실패</span>}
                </div>
              </div>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
