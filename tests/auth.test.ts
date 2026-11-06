import { describe, expect, it } from "vitest";
import { makeToken, verifyToken } from "@/lib/auth";

describe("로그인 쿠키", () => {
  it("서명이 맞고 기한 안이면 통과", () => {
    const t = makeToken("s3cret", 1000);
    expect(verifyToken(t, "s3cret", 2000)).toBe(true);
  });
  it("다른 비밀 값, 위조, 만료는 거부", () => {
    const t = makeToken("s3cret", 1000);
    expect(verifyToken(t, "other", 2000)).toBe(false);
    expect(verifyToken(t.replace(/^\d+/, "9999999999999"), "s3cret", 2000)).toBe(false);
    expect(verifyToken(t, "s3cret", 1000 + 31 * 86400_000)).toBe(false);
    expect(verifyToken(undefined, "s3cret")).toBe(false);
  });
});
