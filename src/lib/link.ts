// 링크는 수년 안에 상당수가 사라진다. 그래서 받은 시점의 본문 사본을 함께 보관한다.

const MAX_BYTES = 3 * 1024 * 1024;

export type LinkSnapshot = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  text: string;
  bytes: Uint8Array;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** HTML에서 제목과 읽을 수 있는 본문만 뽑는다 (외부 라이브러리 없이) */
export function extractReadable(html: string): { title: string | null; text: string } {
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    null;
  const body = html
    .replace(/<(head|script|style|noscript|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title: title ? decodeEntities(title).trim() : null, text: text.slice(0, 100_000) };
}

export async function snapshot(url: string): Promise<LinkSnapshot> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("http(s) 링크만 보관합니다");

  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; GiroksoArchiver/1.0)", accept: "text/html,*/*" },
  });
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(Buffer.concat(chunks).subarray(0, MAX_BYTES));

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const isHtml = contentType.includes("html");
  const { title, text } = isHtml
    ? extractReadable(new TextDecoder().decode(bytes))
    : { title: null, text: "" };
  return { url, finalUrl: res.url, status: res.status, contentType, title, text, bytes };
}
