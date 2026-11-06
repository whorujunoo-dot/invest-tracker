import { env } from "./env";

const tz = () => env.timeZone;

export function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: tz(), year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(d);
}

export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function timeLabel(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: tz(), hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function dateTimeLabel(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: tz(), dateStyle: "medium", timeStyle: "short", hour12: false }).format(d);
}

export function duration(sec: number | null | undefined): string {
  if (!sec) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

export const KIND_LABEL: Record<string, string> = { text: "글", voice: "음성", image: "사진", link: "링크", file: "파일" };
