import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";

// 혼자 쓰는 앱이므로 사용자 계정 없이 비밀번호 하나와 서명된 쿠키로 보호한다.
export const SESSION_COOKIE = "girokso_session";
const SESSION_DAYS = 30;

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function makeToken(secret: string, now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86400_000);
  return `${exp}.${sign(exp, secret)}`;
}

export function verifyToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp, secret))) return false;
  return Number(exp) > now;
}

export function checkPassword(input: string): boolean {
  return safeEqual(sign(input, env.sessionSecret), sign(env.appPassword, env.sessionSecret));
}

export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value, env.sessionSecret);
}

export async function requireSignIn() {
  if (!(await isSignedIn())) redirect("/login");
}

export async function startSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, makeToken(env.sessionSecret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export function isCronAuthorized(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), env.cronSecret);
}
