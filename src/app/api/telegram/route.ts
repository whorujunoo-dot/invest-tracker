import { after } from "next/server";
import { safeEqual } from "@/lib/auth";
import { env } from "@/lib/env";
import { ingestUpdate, receiptText } from "@/lib/ingest";
import { runJobs } from "@/lib/jobs";
import { reply, type TgUpdate } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // 텔레그램이 보낸 요청인지 비밀 값으로 확인
  const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(secret, env.telegramWebhookSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const update = (await req.json()) as TgUpdate;

  // 저장에 실패하면 500을 돌려준다. 그러면 텔레그램이 같은 메시지를 다시 보내 준다.
  const result = await ingestUpdate(update, env.telegramOwnerId);

  if (result.status === "saved") {
    const ref = result.parsed.sourceRef;
    await reply(ref.chat_id, ref.message_id, receiptText(result));
    after(() => runJobs({ recordId: result.recordId, deadlineMs: 50_000 }).catch(console.error));
  } else if (result.status === "edited") {
    const msg = update.edited_message!;
    await reply(msg.chat.id, msg.message_id, "✎ 수정본을 저장했습니다. 이전 판도 남아 있습니다.");
  }

  return Response.json({ ok: true });
}
