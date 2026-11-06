import { RecordList } from "../record-list";
import { listRecords } from "@/lib/queries";

export default async function TrashPage() {
  const items = await listRecords({ trash: true });
  return (
    <main className="block" style={{ gap: 16 }}>
      <h1>휴지통</h1>
      <p className="muted">휴지통의 기록은 자동으로 사라지지 않습니다. 기록을 열어 되살릴 수 있습니다.</p>
      {items.length === 0 ? <div className="empty"><p>휴지통이 비어 있습니다.</p></div> : <RecordList items={items} />}
    </main>
  );
}
