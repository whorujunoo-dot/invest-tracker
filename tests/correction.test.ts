import { describe, expect, it } from "vitest";
import { joinSegments, reconstructsOriginal } from "@/lib/ai/claude";

const transcript = "어 속셀은 금리 인하 전까지 들고 가고 쿠팡 로켓 그로스는 다음달 부터";

describe("교정본 검증", () => {
  const good = [
    { text: "", original: "어 ", unsure: false },
    { text: "SOXL", original: "속셀", unsure: false },
    { text: "은 금리 인하 전까지 들고 가고, 쿠팡 ", original: null, unsure: false },
    { text: "로켓그로스", original: "로켓 그로스", unsure: false },
    { text: "는 ", original: null, unsure: false },
    { text: "다음 달부터", original: "다음달 부터", unsure: true },
  ];

  it("모든 변경이 표시되어 있으면 원문이 되살아난다", () => {
    // 쉼표처럼 원문에 없는 글자를 '고치지 않은 조각'에 몰래 넣으면 실패해야 한다
    expect(reconstructsOriginal(good, transcript)).toBe(false);
    const honest = good.map((s, i) => (i === 2 ? { text: "은 금리 인하 전까지 들고 가고, 쿠팡 ", original: "은 금리 인하 전까지 들고 가고 쿠팡 ", unsure: false } : s));
    expect(reconstructsOriginal(honest, transcript)).toBe(true);
    expect(joinSegments(honest)).toBe("SOXL은 금리 인하 전까지 들고 가고, 쿠팡 로켓그로스는 다음 달부터");
  });

  it("표시 없이 뜻을 바꾸면 잡아낸다", () => {
    const sneaky = [{ text: "SOXL은 금리 인하 후에 판다", original: null, unsure: false }];
    expect(reconstructsOriginal(sneaky, transcript)).toBe(false);
  });
});

describe("사소한 변경 구분", () => {
  it("문장 부호·띄어쓰기만 바뀌면 표시하지 않는다", async () => {
    const { isTrivialChange } = await import("@/lib/ai/claude");
    expect(isTrivialChange({ text: "가고, 추가", original: "가고 추가", unsure: false })).toBe(true);
    expect(isTrivialChange({ text: "SOXL", original: "속셀", unsure: false })).toBe(false);
    expect(isTrivialChange({ text: "다음 달부터", original: "다음달 부터", unsure: true })).toBe(false);
  });
});
