import { isSignedIn } from "@/lib/auth";
import { sql } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";

// 원본 파일 열기: 로그인한 경우에만 10분짜리 임시 주소로 넘겨준다.
export async function GET(_req: Request, ctx: { params: Promise<{ sha: string }> }) {
  if (!(await isSignedIn())) return new Response("unauthorized", { status: 401 });
  const { sha } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(sha)) return new Response("not found", { status: 404 });
  const [b] = await sql()<{ storage_key: string }[]>`select storage_key from blobs where sha256 = ${sha}`;
  if (!b) return new Response("not found", { status: 404 });
  return Response.redirect(await signedUrl(b.storage_key), 302);
}
