import { isCronAuthorized } from "@/lib/auth";
import { runJobs } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

// 밀린 처리 작업을 다시 돌린다. GitHub Actions(매시간)와 Vercel(매일)이 부른다.
async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await runJobs({ limit: 50, deadlineMs: 50_000 });
  return Response.json(result);
}

export const GET = handle;
export const POST = handle;
