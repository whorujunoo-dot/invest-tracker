import { env } from "../env";

// 음성 → 글자. Claude는 음성을 직접 받지 않으므로 전용 받아쓰기 서비스를 쓴다.
// 다른 서비스(ElevenLabs Scribe, 네이버 CLOVA 등)로 바꿀 때는 이 파일만 고치면 된다.

export async function transcribe(
  audio: Uint8Array,
  mime: string,
  vocabulary: string[],
): Promise<{ text: string; model: string }> {
  const form = new FormData();
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "wav";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `voice.${ext}`);
  form.append("model", env.transcribeModel);
  form.append("language", "ko");
  if (vocabulary.length) {
    form.append("prompt", `자주 나오는 단어: ${vocabulary.slice(0, 100).join(", ")}`);
  }

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.openaiApiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`받아쓰기 실패 (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? "").trim(), model: env.transcribeModel };
}
