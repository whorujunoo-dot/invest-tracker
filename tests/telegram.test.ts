import { describe, expect, it } from "vitest";
import { extractTags, extractUrls, parseMessage, type TgMessage } from "@/lib/telegram";

const base = { message_id: 7, date: 1762400000, chat: { id: 42, type: "private" }, from: { id: 42 } };

describe("태그와 링크 뽑기", () => {
  it("한글·영문 태그를 소문자로, 중복 없이", () => {
    expect(extractTags("#투자 SOXL 생각 #SOXL #투자 이메일a#b")).toEqual(["투자", "soxl"]);
  });
  it("링크 끝의 문장부호는 뺀다", () => {
    expect(extractUrls("참고 https://example.com/a?b=1. 끝")).toEqual(["https://example.com/a?b=1"]);
  });
  it("숨겨진 링크(text_link)도 찾는다", () => {
    expect(extractUrls("여기", [{ type: "text_link", offset: 0, length: 2, url: "https://x.y/z" }])).toEqual(["https://x.y/z"]);
  });
});

describe("메시지 분류", () => {
  it("음성", () => {
    const p = parseMessage({ ...base, voice: { file_id: "f", file_unique_id: "u", duration: 133, mime_type: "audio/ogg" } } as TgMessage)!;
    expect(p.kind).toBe("voice");
    expect(p.file?.duration).toBe(133);
    expect(p.sourceRef).toEqual({ chat_id: "42", message_id: "7" });
  });
  it("사진은 가장 큰 크기를 원본으로", () => {
    const p = parseMessage({ ...base, caption: "#책", photo: [
      { file_id: "s", file_unique_id: "s", width: 90, height: 90 },
      { file_id: "l", file_unique_id: "l", width: 1280, height: 960 },
      { file_id: "m", file_unique_id: "m", width: 320, height: 240 },
    ] } as TgMessage)!;
    expect(p.kind).toBe("image");
    expect(p.file?.file_id).toBe("l");
    expect(p.tags).toEqual(["책"]);
  });
  it("링크만 있으면 링크, 생각이 길면 글", () => {
    expect(parseMessage({ ...base, text: "https://news.example/a #투자" })!.kind).toBe("link");
    expect(parseMessage({ ...base, text: "이 기사 보고 든 생각인데 금리 인하가 늦어지면 반도체는 더 빠질 수 있다 https://news.example/a" })!.kind).toBe("text");
  });
  it("전달받은 메시지 표시", () => {
    expect(parseMessage({ ...base, text: "글", forward_origin: { type: "user" } })!.sourceRef.forwarded).toBe(true);
  });
  it("내용 없는 메시지는 무시", () => {
    expect(parseMessage({ ...base } as TgMessage)).toBeNull();
  });
});
