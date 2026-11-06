import { redirect } from "next/navigation";
import { checkPassword, isSignedIn, startSession } from "@/lib/auth";
import { audit } from "@/lib/db";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 1500)); // 무차별 대입을 느리게
    await audit("web", "login_failed", null);
    redirect("/login?error=1");
  }
  await startSession();
  await audit("web", "login", null);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isSignedIn()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login">
      <h1>기록소</h1>
      <form action={login} className="block">
        <label htmlFor="password" className="muted">비밀번호</label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required autoFocus />
        {error && <p className="bad muted">비밀번호가 맞지 않습니다.</p>}
        <button className="btn primary" type="submit">들어가기</button>
      </form>
    </main>
  );
}
