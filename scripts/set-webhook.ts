// 텔레그램 봇이 메시지를 이 앱으로 보내도록 연결한다.
// 사용: APP_URL=https://내주소.vercel.app TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run telegram:webhook
import { setWebhook } from "../src/lib/telegram";

const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!appUrl || !secret) throw new Error("APP_URL 과 TELEGRAM_WEBHOOK_SECRET 이 필요합니다");

await setWebhook(`${appUrl}/api/telegram`, secret);
console.log(`연결 완료: ${appUrl}/api/telegram`);
