// 이슈 채팅 메시지 시각(WP-833) — 오늘·어제 판정과 시각이 Asia/Seoul 기준인지. 시간대가 다른 브라우저 재현은 E2E(chat.spec, timezoneId UTC)가 맡는다.
import { describe, expect, it } from 'vitest';

import { formatChatTimestamp } from './formatChatTimestamp';

// KST 2026-10-23 01:30 = UTC 2026-10-22 16:30 — UTC 날짜와 KST 날짜가 다른 순간.
const NOW = new Date('2026-10-22T16:30:00Z');

describe('formatChatTimestamp', () => {
  it('KST 오늘이면 KST 시각(HH:mm)', () => {
    expect(formatChatTimestamp('2026-10-22T16:28:00Z', NOW)).toBe('01:28');
  });

  it('KST 어제면 「어제 HH:mm」 — UTC 로는 같은 날이어도', () => {
    expect(formatChatTimestamp('2026-10-22T14:50:00Z', NOW)).toBe('어제 23:50');
  });

  it('그 전이면 KST 월·일', () => {
    expect(formatChatTimestamp('2026-10-20T15:10:00Z', NOW)).toBe('10월 21일');
  });

  it('서버 LocalDateTime(타임존 없음)은 UTC 로 읽는다', () => {
    expect(formatChatTimestamp('2026-10-22T16:28:00', NOW)).toBe('01:28');
  });

  it('무효 입력이면 빈 문자열', () => {
    expect(formatChatTimestamp('nope', NOW)).toBe('');
  });
});
