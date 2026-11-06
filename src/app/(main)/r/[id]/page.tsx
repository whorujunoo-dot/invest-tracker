import Link from "next/link";
import { notFound } from "next/navigation";
import { getRecord } from "@/lib/queries";
import { bytes, dateTimeLabel, duration, KIND_LABEL } from "@/lib/format";
import { isTrivialChange, type CorrectionSegment } from "@/lib/ai/claude";
import { moveToTrash, reprocess, restoreFromTrash, saveTags, saveVersion, toggleAiExcluded } from "../../actions";

const JOB_LABEL: Record<string, string> = {
  fetch_file: "파일 내려받기", transcribe: "받아쓰기", correct: "교정", image_text: "이미지 글자 읽기", link_snapshot: "링크 사본 보관",
};
const JOB_STATUS: Record<string, string> = { queued: "대기", running: "처리 중", done: "완료", failed: "실패" };

function Corrected({ segments }: { segments: CorrectionSegment[] }) {
  return (
    <p className="body-text">
      {segments.map((s, i) =>
        isTrivialChange(s) ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i} className={s.unsure ? "unsure" : undefined} title={`받아쓰기 원문: ${s.original || "(빈칸)"}`}>
            {s.text || "​"}
          </mark>
        ),
      )}
    </p>
  );
}

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getRecord(id);
  if (!data) notFound();
  const { rec, files, versions, transcript, correction, imageText, link, jobs, history, derivations } = data;
  const original = files.find((f) => f.role === "original");
  const latestVersion = versions[0];
  const duration_ = original?.meta.duration as number | undefined;
  const changes = correction?.segments.filter((s) => !isTrivialChange(s)) ?? [];

  return (
    <main className="block" style={{ gap: 22 }}>
      <div className="block" style={{ gap: 4 }}>
        <Link href="/" className="muted">← 흐름</Link>
        <h1>{dateTimeLabel(rec.occurred_at)}</h1>
        <div className="meta">
          <span>{KIND_LABEL[rec.kind]}{duration_ ? ` ${duration(duration_)}` : ""}</span>
          {rec.tags.map((t) => <Link key={t} href={`/?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}
          {rec.source_ref.forwarded ? <span>전달받은 메시지</span> : null}
          {rec.ai_excluded && <span className="bad">AI 처리 제외</span>}
          {rec.deleted_at && <span className="bad">휴지통에 있음</span>}
        </div>
      </div>

      {/* 원문 영역: 사용자가 보낸 그대로 */}
      <section className="block">
        <h2>원문</h2>
        {original && rec.kind === "voice" && <audio controls preload="none" src={`/api/files/${original.blob_sha256}`} />}
        {original && rec.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="original" src={`/api/files/${original.blob_sha256}`} alt="보낸 사진 원본" />
        )}
        {original && rec.kind === "file" && (
          <a className="btn" href={`/api/files/${original.blob_sha256}`}>원본 파일 열기 ({bytes(Number(original.size_bytes))})</a>
        )}

        {correction ? (
          <div className="panel main">
            <div className="panel-head">
              <strong>교정본</strong>
              <span className="muted">
                {changes.length ? `고친 곳 ${changes.length}` : "고친 곳 없음"}
                {changes.some((s) => s.unsure) ? " · 점선은 확인 필요" : ""}
              </span>
            </div>
            {!correction.verified && (
              <p className="bad muted">교정 내용을 받아쓰기 원문과 대조하지 못했습니다. 아래 원문을 기준으로 봐 주세요.</p>
            )}
            <Corrected segments={correction.segments} />
            {changes.length > 0 && (
              <details>
                <summary>고친 곳 보기</summary>
                <table className="kv"><tbody>
                  {changes.map((s, i) => (
                    <tr key={i}>
                      <td>{s.original || "(빈칸)"}</td>
                      <td>→ {s.text.trim() || "(지움)"}{s.unsure ? <span className="bad"> · 확인 필요</span> : null}</td>
                    </tr>
                  ))}
                </tbody></table>
              </details>
            )}
          </div>
        ) : null}

        {transcript && (
          <details open={!correction}>
            <summary>받아쓰기 원문 (기계가 들은 그대로)</summary>
            <p className="body-text">{transcript.text || "(인식된 말이 없습니다)"}</p>
          </details>
        )}

        {rec.original_text && (
          <div className="panel">
            {rec.kind !== "text" && <span className="muted">함께 보낸 글</span>}
            <p className="body-text">{rec.original_text}</p>
          </div>
        )}

        {latestVersion && (
          <div className="panel main">
            <div className="panel-head">
              <strong>고친 본문</strong>
              <span className="muted">{dateTimeLabel(latestVersion.created_at)} · {latestVersion.source === "user" ? "직접 수정" : "텔레그램에서 수정"}</span>
            </div>
            <p className="body-text">{latestVersion.body}</p>
          </div>
        )}
      </section>

      {/* 분석 영역: 자동으로 만든 부산물 */}
      {(imageText || link) && (
        <section className="block">
          <h2>자동으로 읽은 내용</h2>
          {imageText && (
            <div className="panel">
              <span className="muted">이미지 속 글자 · {imageText.model}</span>
              <p className="body-text">{imageText.text}</p>
            </div>
          )}
          {link && (
            <div className="panel">
              <span className="muted">링크 사본 (받은 시점에 보관)</span>
              {((link.content.pages ?? []) as { url: string; title?: string; sha256?: string; error?: string }[]).map((p) => (
                <div key={p.url} className="block" style={{ gap: 2 }}>
                  <a href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", overflowWrap: "anywhere" }}>{p.title || p.url}</a>
                  {p.sha256 ? <a className="muted" href={`/api/files/${p.sha256}`}>보관된 사본 열기</a> : <span className="bad muted">보관 실패: {p.error}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {jobs.length > 0 && (
        <section className="block">
          <h2>처리 상태</h2>
          <table className="kv"><tbody>
            {jobs.map((j, i) => (
              <tr key={i}>
                <td>{JOB_LABEL[j.type] ?? j.type}</td>
                <td className={j.status === "failed" ? "bad" : j.status === "done" ? "ok" : undefined}>
                  {JOB_STATUS[j.status]}{j.attempts > 1 ? ` (${j.attempts}회 시도)` : ""}
                  {j.last_error && j.status !== "done" ? <div className="muted">{j.last_error}</div> : null}
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}

      <section className="block">
        <h2>관리</h2>
        <details>
          <summary>본문 고치기 (원문과 이전 판은 그대로 남습니다)</summary>
          <form action={saveVersion} className="block">
            <input type="hidden" name="id" value={rec.id} />
            <textarea id="body" name="body" defaultValue={latestVersion?.body ?? correction?.text ?? rec.original_text ?? transcript?.text ?? ""} />
            <div><button className="btn primary" type="submit">새 판으로 저장</button></div>
          </form>
        </details>
        <form action={saveTags} className="row">
          <input type="hidden" name="id" value={rec.id} />
          <input id="tags" name="tags" className="field" style={{ flex: 1, minWidth: 0 }} defaultValue={rec.tags.map((t) => "#" + t).join(" ")} placeholder="#투자 #사업" aria-label="태그" />
          <button className="btn" type="submit">태그 저장</button>
        </form>
        <div className="row">
          {(rec.kind === "voice" || rec.kind === "image" || link) && (
            <form action={reprocess}><input type="hidden" name="id" value={rec.id} /><button className="btn" type="submit">처리 다시 하기</button></form>
          )}
          <form action={toggleAiExcluded}><input type="hidden" name="id" value={rec.id} />
            <button className="btn" type="submit">{rec.ai_excluded ? "AI 처리 허용" : "AI 처리에서 제외"}</button></form>
          {rec.deleted_at ? (
            <form action={restoreFromTrash}><input type="hidden" name="id" value={rec.id} /><button className="btn" type="submit">휴지통에서 되살리기</button></form>
          ) : (
            <form action={moveToTrash}><input type="hidden" name="id" value={rec.id} /><button className="btn danger" type="submit">휴지통으로</button></form>
          )}
        </div>
      </section>

      <details>
        <summary>이력과 보관 정보</summary>
        <table className="kv"><tbody>
          <tr><td>기록 번호</td><td className="mono">{rec.id}</td></tr>
          <tr><td>받은 시각</td><td>{dateTimeLabel(rec.created_at)}</td></tr>
          {files.map((f) => (
            <tr key={f.blob_sha256 + f.role}><td>{f.role === "original" ? "원본 파일" : "링크 사본"}</td>
              <td className="mono" style={{ overflowWrap: "anywhere" }}>{f.blob_sha256.slice(0, 16)}… · {f.mime_type} · {bytes(Number(f.size_bytes))}</td></tr>
          ))}
          {versions.slice(1).map((v) => (
            <tr key={v.id}><td>이전 판 · {dateTimeLabel(v.created_at)}</td><td className="body-text">{v.body}</td></tr>
          ))}
          {derivations.filter((d) => d.superseded_at).map((d) => (
            <tr key={d.id}><td>이전 처리 결과 · {JOB_LABEL[d.type === "transcript" ? "transcribe" : d.type === "correction" ? "correct" : d.type] ?? d.type}</td>
              <td className="body-text muted">{d.text}</td></tr>
          ))}
          {history.map((h, i) => (
            <tr key={i}><td>{dateTimeLabel(h.at)}</td><td>{h.actor} · {h.action}</td></tr>
          ))}
        </tbody></table>
      </details>
    </main>
  );
}
