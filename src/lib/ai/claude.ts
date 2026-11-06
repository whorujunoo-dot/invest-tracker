import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "../env";

let client: Anthropic | undefined;
function claude(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 3 });
  return client;
}

/** 안전 정책상 답을 거절한 경우. 다시 시도해도 같은 결과이므로 재시도하지 않는다. */
export class RefusedError extends Error {}

// 요청 형식을 바꾸면 이 번호를 올린다. 결과마다 어떤 지침으로 만들었는지 남기기 위해서다.
export const CORRECTION_PROMPT_VERSION = "correct-v1";
export const IMAGE_PROMPT_VERSION = "image-v1";

// ───────── 받아쓰기 교정 ─────────

const Segment = z.object({
  text: z.string().describe("교정본에 들어갈 글 조각"),
  original: z
    .string()
    .nullable()
    .describe("고친 조각이면 받아쓰기 원문에 있던 글자 그대로, 고치지 않은 조각이면 null"),
  unsure: z.boolean().describe("문맥상 추측이 들어간 교정이면 true"),
});
const CorrectionSchema = z.object({ segments: z.array(Segment) });
export type CorrectionSegment = z.infer<typeof Segment>;

const CORRECTION_SYSTEM = `당신은 한국어 음성 메모의 받아쓰기 교정 담당입니다. 사용자는 투자자이자 이커머스 사업 운영자이고, 이 메모는 수십 년 보관할 개인 기록입니다.

고칠 수 있는 것:
- 잘못 들린 단어 (예: "속셀" → "SOXL", "로켓 그로스" → "로켓그로스")
- 종목명, 상품명, 회사명, 사람 이름 같은 고유명사
- 띄어쓰기와 문장 부호
- 의미 없는 군말 ("어", "음", 같은 말 반복)

절대 하지 말 것:
- 말한 사람의 뜻, 주장, 판단, 감정을 바꾸기
- 숫자, 날짜, 금액, 비율을 바꾸기. 문맥상 명백히 잘못 들린 경우만 고치고 unsure를 true로
- 내용 추가, 요약, 순서 바꾸기, 문체 다듬기

출력 방법:
- 교정본 전체를 앞에서부터 순서대로 조각(segments)으로 나눠 내보냅니다.
- 고치지 않은 부분은 original을 null로 둡니다.
- 고친 부분은 original에 받아쓰기 원문의 해당 글자를 빠짐없이 그대로 적습니다. 지운 군말도 text를 ""로, original에 지운 글자를 적습니다.
- 모든 조각의 (original이 있으면 original, 없으면 text)를 이어 붙이면 받아쓰기 원문과 정확히 같아야 합니다.
- 고친 조각은 바뀐 단어만 되도록 짧게 나눕니다. 고치지 않은 부분까지 고친 조각에 넣지 않습니다.
- 확신이 낮은 교정은 unsure를 true로 둡니다.`;

function normalize(s: string) {
  return s.replace(/\s+/g, "");
}

/** 조각들로 받아쓰기 원문을 되살릴 수 있는지 확인한다. 되살아나면 모든 변경이 화면에 드러난다는 뜻이다. */
export function reconstructsOriginal(segments: CorrectionSegment[], transcript: string): boolean {
  const rebuilt = segments.map((s) => (s.original ?? s.text)).join("");
  return normalize(rebuilt) === normalize(transcript);
}

/** 띄어쓰기·문장 부호만 바뀐 조각인가 (화면에서 표시하지 않는다) */
export function isTrivialChange(s: CorrectionSegment): boolean {
  if (s.original === null) return true;
  const strip = (x: string) => x.replace(/[\s.,!?·…'"“”‘’()\-~]/g, "");
  return strip(s.original) === strip(s.text) && !s.unsure;
}

export function joinSegments(segments: CorrectionSegment[]): string {
  return segments.map((s) => s.text).join("").replace(/[ \t]{2,}/g, " ").trim();
}

export async function correctTranscript(transcript: string, vocabulary: string[]) {
  const vocab = vocabulary.length ? `\n\n사용자 단어장 (이 표기를 우선 사용):\n${vocabulary.join(", ")}` : "";

  const response = await claude().beta.messages.parse({
    model: env.claudeModel,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(CorrectionSchema) },
    system: CORRECTION_SYSTEM + vocab,
    messages: [{ role: "user", content: `받아쓰기 원문:\n${transcript}` }],
  });

  if (response.stop_reason === "refusal") throw new RefusedError("교정 요청이 거절되었습니다");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`교정 결과를 읽지 못했습니다 (stop_reason: ${response.stop_reason})`);

  return {
    segments: parsed.segments,
    text: joinSegments(parsed.segments),
    verified: reconstructsOriginal(parsed.segments, transcript),
    model: response.model,
  };
}

// ───────── 이미지 속 글자와 내용 ─────────

const ImageSchema = z.object({
  text_in_image: z.string().describe("이미지에 보이는 글자를 그대로 옮긴 것. 없으면 빈 문자열"),
  description: z.string().describe("이미지가 무엇인지 한두 문장 설명 (한국어)"),
});

const IMAGE_SYSTEM = `사용자가 책, 웹페이지, 자료에서 찍은 사진이나 캡처를 보냈습니다.
1) 이미지 속 글자를 보이는 그대로 빠짐없이 옮깁니다. 줄바꿈은 살리고, 읽을 수 없는 글자는 [?]로 둡니다. 번역하거나 요약하지 않습니다.
2) 이미지가 무엇인지 한두 문장으로 설명합니다. 보이지 않는 내용은 추측해서 쓰지 않습니다.`;

type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function readImage(bytes: Uint8Array, mime: string) {
  const media_type: ImageMime = (["image/png", "image/webp", "image/gif"] as const).includes(mime as never)
    ? (mime as ImageMime)
    : "image/jpeg";

  const response = await claude().beta.messages.parse({
    model: env.claudeModel,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ImageSchema) },
    system: IMAGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: "이 이미지를 처리해 주세요." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new RefusedError("이미지 처리 요청이 거절되었습니다");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`이미지 결과를 읽지 못했습니다 (stop_reason: ${response.stop_reason})`);
  return { ...parsed, model: response.model };
}
