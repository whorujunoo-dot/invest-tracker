import Link from "next/link";
import { requireSignIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requireSignIn();
  return (
    <div className="shell">
      <header className="top">
        <Link href="/" className="brand">기록소</Link>
        <nav className="nav">
          <Link href="/">흐름</Link>
          <Link href="/trash">휴지통</Link>
          <Link href="/settings">보관 상태</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
