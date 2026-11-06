import { sql } from "@/lib/db";
import { stats } from "@/lib/queries";
import { bytes, dateTimeLabel } from "@/lib/format";
import { addVocabulary, removeVocabulary } from "../actions";

const RUN_LABEL: Record<string, string> = { backup: "마지막 백업", restore_check: "마지막 복구 검증", export: "마지막 내보내기" };

export default async function SettingsPage() {
  const [s, vocab] = await Promise.all([
    stats(),
    sql()<{ term: string; note: string | null }[]>`select term, note from vocabulary order by term`,
  ]);
  const staleMs = 36 * 3600_000;

  return (
    <main className="block" style={{ gap: 28 }}>
      <h1>보관 상태</h1>

      <section className="block">
        <h2>백업과 복구</h2>
        <table className="kv"><tbody>
          {(["backup", "restore_check", "export"] as const).map((k) => {
            const r = s.runs.find((x) => x.kind === k);
            const stale = k === "backup" && r && Date.now() - r.started_at.getTime() > staleMs;
            return (
              <tr key={k}>
                <td>{RUN_LABEL[k]}</td>
                <td className={!r ? "bad" : !r.ok || stale ? "bad" : "ok"}>
                  {!r ? "아직 기록 없음" : `${r.ok ? "성공" : "실패"} · ${dateTimeLabel(r.started_at)}`}
                  {stale ? " · 하루 넘게 백업이 없습니다" : ""}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      </section>

      <section className="block">
        <h2>쌓인 양</h2>
        <table className="kv"><tbody>
          <tr><td>기록</td><td>{s.records.toLocaleString()}건 (휴지통 {s.trash}건)</td></tr>
          <tr><td>원본 파일</td><td>{s.blobs.toLocaleString()}개 · {bytes(Number(s.bytes))}</td></tr>
          <tr><td>처리 대기</td><td>{s.pending_jobs}건</td></tr>
          <tr><td>처리 실패</td><td className={s.failed_jobs ? "bad" : undefined}>{s.failed_jobs}건</td></tr>
        </tbody></table>
      </section>

      <section className="block">
        <h2>단어장</h2>
        <p className="muted">종목명, 상품명, 거래처처럼 자주 쓰는 단어를 등록하면 받아쓰기와 교정이 정확해집니다.</p>
        <form action={addVocabulary} className="row">
          <input id="term" name="term" className="field" style={{ flex: "1 1 140px", minWidth: 0 }} placeholder="예: SOXL" required />
          <input id="note" name="note" className="field" style={{ flex: "2 1 180px", minWidth: 0 }} placeholder="설명 (선택)" />
          <button className="btn primary" type="submit">추가</button>
        </form>
        {vocab.length > 0 && (
          <table className="kv"><tbody>
            {vocab.map((v) => (
              <tr key={v.term}>
                <td>{v.term}</td>
                <td className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{v.note}</span>
                  <form action={removeVocabulary}><input type="hidden" name="term" value={v.term} /><button className="btn" type="submit">빼기</button></form>
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>
    </main>
  );
}
