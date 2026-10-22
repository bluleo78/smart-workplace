// 이슈 채팅 메시지 시각 표시: 오늘이면 HH:mm, 어제면 '어제 HH:mm', 그 외는 'M월 D일'.
// 날짜 구분선(DateDivider·getDateKey)과 팀 채팅 시각(formatClockTime)처럼 Asia/Seoul 기준이다(WP-833) — 브라우저 로컬 시간대를 쓰면
// 한국 밖 시간대에서 구분선 날짜와 시각이 서로 다른 날을 가리켰다(「10월 23일」 구분선 아래 UTC 「16:28」).
import { kstDayRelative, kstParts, parseUtcDate } from '../../../../lib/formatters';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 무효 입력이면 빈 문자열 — Intl.formatToParts 가 Invalid Date 에 RangeError 를 던지므로 먼저 거른다. */
export function formatChatTimestamp(iso: string, now: Date = new Date()): string {
  const date = parseUtcDate(iso);
  if (Number.isNaN(date.getTime())) return '';
  const t = kstParts(date);
  const rel = kstDayRelative(t, now);
  if (rel === 'today') return `${pad2(t.h)}:${pad2(t.min)}`;
  if (rel === 'yesterday') return `어제 ${pad2(t.h)}:${pad2(t.min)}`;
  return `${t.m}월 ${t.d}일`;
}
