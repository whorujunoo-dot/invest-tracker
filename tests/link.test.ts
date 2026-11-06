import { describe, expect, it } from "vitest";
import { extractReadable } from "@/lib/link";

describe("링크 본문 뽑기", () => {
  it("제목과 본문만 남기고 스크립트는 버린다", () => {
    const r = extractReadable(`<html><head><title>기사 &amp; 제목</title><script>var x=1</script></head>
      <body><nav>메뉴</nav><p>첫 문단</p><p>둘째&nbsp;문단</p></body></html>`);
    expect(r.title).toBe("기사 & 제목");
    expect(r.text).toBe("첫 문단\n둘째 문단");
  });
});
