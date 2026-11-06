import { env } from "./env";

// ───────── 텔레그램 메시지 형식 (필요한 부분만) ─────────

export type TgFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
  duration?: number;
  width?: number;
  height?: number;
};

export type TgEntity = { type: string; offset: number; length: number; url?: string };

export type TgMessage = {
  message_id: number;
  date: number;
  edit_date?: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean };
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  voice?: TgFile;
  audio?: TgFile;
  video_note?: TgFile;
  video?: TgFile;
  photo?: TgFile[];
  document?: TgFile;
  media_group_id?: string;
  forward_origin?: unknown;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
};

// ───────── 받은 메시지를 기록 한 건의 형태로 정리 ─────────

export type Kind = "text" | "voice" | "image" | "link" | "file";

export type ParsedInput = {
  kind: Kind;
  text: string | null;
  tags: string[];
  urls: string[];
  file: (TgFile & { role: "voice" | "image" | "file" }) | null;
  occurredAt: Date;
  sourceRef: {
    chat_id: string;
    message_id: string;
    media_group_id?: string;
    forwarded?: boolean;
  };
};

const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_]{1,40})/gu;

export function extractTags(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

const URL_RE = /https?:\/\/[^\s<>"'）)]+/g;

export function extractUrls(text: string | null | undefined, entities?: TgEntity[]): string[] {
  const out = new Set<string>();
  for (const e of entities ?? []) {
    if (e.type === "text_link" && e.url) out.add(e.url);
  }
  for (const m of (text ?? "").matchAll(URL_RE)) out.add(m[0].replace(/[.,!?]+$/, ""));
  return [...out];
}

/** 메시지 하나를 기록으로 바꾼다. 다룰 수 없는 형식이면 null */
export function parseMessage(msg: TgMessage): ParsedInput | null {
  const text = msg.text ?? msg.caption ?? null;
  const entities = msg.entities ?? msg.caption_entities;
  const urls = extractUrls(text, entities);

  let kind: Kind;
  let file: ParsedInput["file"] = null;

  const audio = msg.voice ?? msg.audio ?? msg.video_note;
  if (audio) {
    kind = "voice";
    file = { ...audio, role: "voice" };
  } else if (msg.photo?.length) {
    kind = "image";
    // 가장 큰 크기의 사진을 원본으로 보관
    const largest = [...msg.photo].sort(
      (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
    )[0];
    file = { ...largest, mime_type: "image/jpeg", role: "image" };
  } else if (msg.document?.mime_type?.startsWith("image/")) {
    kind = "image";
    file = { ...msg.document, role: "image" };
  } else if (msg.document?.mime_type?.startsWith("audio/")) {
    kind = "voice";
    file = { ...msg.document, role: "voice" };
  } else if (msg.document || msg.video) {
    kind = "file";
    file = { ...(msg.document ?? msg.video)!, role: "file" };
  } else if (text) {
    // 글 대부분이 링크 하나뿐이면 '링크' 기록으로 본다
    const stripped = urls.reduce((t, u) => t.replace(u, ""), text).replace(TAG_RE, "").trim();
    kind = urls.length > 0 && stripped.length < 20 ? "link" : "text";
  } else {
    return null;
  }

  return {
    kind,
    text,
    tags: extractTags(text),
    urls,
    file,
    occurredAt: new Date(msg.date * 1000),
    sourceRef: {
      chat_id: String(msg.chat.id),
      message_id: String(msg.message_id),
      ...(msg.media_group_id ? { media_group_id: msg.media_group_id } : {}),
      ...(msg.forward_origin ? { forwarded: true } : {}),
    },
  };
}

// ───────── 텔레그램 서버와 주고받기 ─────────

const API = "https://api.telegram.org";

export const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024; // 봇이 내려받을 수 있는 최대 크기

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/bot${env.telegramToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`텔레그램 ${method} 실패: ${json.description ?? res.status}`);
  return json.result;
}

export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const info = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info.file_path) throw new Error("텔레그램이 파일 경로를 주지 않았습니다");
  const res = await fetch(`${API}/file/bot${env.telegramToken}/${info.file_path}`);
  if (!res.ok) throw new Error(`파일 내려받기 실패: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function reply(chatId: string | number, replyTo: string | number, text: string) {
  try {
    await call("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4000),
      reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true },
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    // 답장 실패는 기록 저장에 영향을 주지 않는다
    console.error("telegram reply failed", e);
  }
}

export async function setWebhook(url: string, secret: string) {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "edited_message"],
    drop_pending_updates: false,
  });
}
