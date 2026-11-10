// AI 계정 표 표시 규칙(WP-1451·1465) — 상태 우선순위·실패 이유·막대 색·빈 창·초기화 문구·사용량 확인·마지막 사용 문구.
// vitest 는 TZ=Asia/Seoul 고정(vitest.config.ts) — 주간 날짜·요일은 KST 로 본다. 상대 시각은 Date 만 가짜로 고정한다.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import type { AccountUsage, AgentAccountResponse } from '@/types/agentAccount';

import {
  accountStatusPill,
  checkedText,
  emptyWindowText,
  formatResetCountdown,
  formatUsedPercent,
  formatWeeklyReset,
  isUnlimitedAccount,
  isWindowReset,
  lastUsedText,
  usageBarTone,
  usageBarWidth,
  WINDOW_RESET_TEXT,
} from './agentAccountUsage';
import { EMPTY_GLYPH } from './formatters';

// 2026-11-09(월) 10:00 KST
const NOW = new Date('2026-11-09T01:00:00Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

function usage(over: Partial<AccountUsage> = {}): AccountUsage {
  return {
    status: 'OK',
    fiveHour: null,
    weekly: null,
    checkedAt: null,
    succeededAt: null,
    errorCode: null,
    errorMessage: null,
    lastUsedAt: null,
    ...over,
  };
}

function account(over: Partial<Pick<AgentAccountResponse, 'status' | 'usage'>> = {}): Pick<AgentAccountResponse, 'status' | 'usage'> {
  return { status: 'ACTIVE', usage: usage(), ...over };
}

describe('accountStatusPill', () => {
  test('사용량 상태마다 문구·색 — OK·UNLIMITED 는 둘 다 「정상」', () => {
    expect(accountStatusPill(account({ usage: usage({ status: 'OK' }) }))).toMatchObject({ label: '정상', type: 'success' });
    expect(accountStatusPill(account({ usage: usage({ status: 'UNLIMITED' }) }))).toMatchObject({ label: '정상', type: 'success' });
    expect(accountStatusPill(account({ usage: usage({ status: 'NEAR_LIMIT' }) }))).toMatchObject({ label: '곧 한도', type: 'warning' });
    expect(accountStatusPill(account({ usage: usage({ status: 'LIMIT_REACHED' }) }))).toMatchObject({ label: '한도 도달', type: 'error' });
    expect(accountStatusPill(account({ usage: usage({ status: 'UNKNOWN' }) }))).toMatchObject({ label: '확인 전', type: 'unknown' });
    expect(accountStatusPill(account({ usage: null }))).toMatchObject({ label: '확인 전', type: 'unknown' });
    expect(accountStatusPill(account({ usage: usage({ status: 'RELOGIN_REQUIRED' }) }))).toMatchObject({ label: '다시 로그인 필요', type: 'error' });
  });

  test('확인 실패는 이유만 한 줄로 준다(배지가 이미 실패를 말하므로 앞머리 없음)', () => {
    const pill = accountStatusPill(account({ usage: usage({ status: 'CHECK_FAILED', errorMessage: '연결 실패' }) }));
    expect(pill).toEqual({ label: '확인 실패', type: 'warning', reason: '연결 실패' });
    // 이유 문구가 없으면 줄도 없다
    expect(accountStatusPill(account({ usage: usage({ status: 'CHECK_FAILED' }) })).reason).toBeNull();
  });

  test('계정이 다시 로그인 필요면 사용량이 OK 여도 그것이 먼저, 실패 이유는 보이지 않는다', () => {
    expect(accountStatusPill(account({ status: 'RELOGIN_REQUIRED', usage: usage({ status: 'OK' }) })).label).toBe('다시 로그인 필요');
    expect(accountStatusPill(account({ status: 'RELOGIN_REQUIRED', usage: usage({ status: 'CHECK_FAILED', errorMessage: '연결 실패' }) }))).toEqual({
      label: '다시 로그인 필요',
      type: 'error',
      reason: null,
    });
  });

  test('계정이 확인 필요(NEEDS_CHECK)면 사용량 판정보다 먼저 「확인 필요」(경고), 다시 로그인 필요보다는 뒤', () => {
    expect(accountStatusPill(account({ status: 'NEEDS_CHECK', usage: usage({ status: 'OK' }) }))).toEqual({ label: '확인 필요', type: 'warning', reason: null });
    expect(accountStatusPill(account({ status: 'NEEDS_CHECK', usage: usage({ status: 'LIMIT_REACHED' }) })).label).toBe('확인 필요');
    expect(accountStatusPill(account({ status: 'NEEDS_CHECK', usage: usage({ status: 'RELOGIN_REQUIRED' }) })).label).toBe('다시 로그인 필요');
  });

  test('확인 필요여도 마지막 조회가 실패했으면 이유 한 줄을 함께 준다', () => {
    expect(accountStatusPill(account({ status: 'NEEDS_CHECK', usage: usage({ status: 'CHECK_FAILED', errorMessage: '연결 실패' }) }))).toEqual({
      label: '확인 필요',
      type: 'warning',
      reason: '사용량 확인 실패 · 연결 실패',
    });
    // 마지막 조회가 실패가 아니면 옛 errorMessage 가 남아 있어도 보이지 않는다
    expect(accountStatusPill(account({ status: 'NEEDS_CHECK', usage: usage({ status: 'OK', errorMessage: '연결 실패' }) })).reason).toBeNull();
  });

  test('쓰는 AI 가 없어도 상태는 사용량대로 — 「쓰는 AI 없음」 판정은 없다', () => {
    expect(accountStatusPill({ status: 'ACTIVE', usage: usage({ status: 'OK' }) }).label).toBe('정상');
    expect(accountStatusPill({ status: 'ACTIVE', usage: null }).label).toBe('확인 전');
  });
});

describe('빈 창 문구', () => {
  const ok = { status: 'ACTIVE' as const, usage: usage({ status: 'OK', checkedAt: '2026-11-09T00:58:00Z' }) };
  test('조회가 성공했는데 창 값이 없으면 「값 없음」', () => {
    expect(emptyWindowText(ok)).toBe('값 없음');
    expect(emptyWindowText({ ...ok, usage: usage({ status: 'NEAR_LIMIT', checkedAt: '2026-11-09T00:58:00Z' }) })).toBe('값 없음');
    expect(emptyWindowText({ ...ok, usage: usage({ status: 'LIMIT_REACHED', checkedAt: '2026-11-09T00:58:00Z' }) })).toBe('값 없음');
  });

  test('조회 전·확인 실패·확인 필요·다시 로그인 필요면 「—」', () => {
    expect(emptyWindowText({ status: 'ACTIVE', usage: null })).toBe(EMPTY_GLYPH);
    expect(emptyWindowText({ status: 'ACTIVE', usage: usage({ status: 'OK' }) })).toBe(EMPTY_GLYPH);
    expect(emptyWindowText({ status: 'ACTIVE', usage: usage({ status: 'UNKNOWN', checkedAt: '2026-11-09T00:58:00Z' }) })).toBe(EMPTY_GLYPH);
    expect(emptyWindowText({ status: 'ACTIVE', usage: usage({ status: 'CHECK_FAILED', checkedAt: '2026-11-09T00:58:00Z' }) })).toBe(EMPTY_GLYPH);
    expect(emptyWindowText({ status: 'ACTIVE', usage: usage({ status: 'RELOGIN_REQUIRED', checkedAt: '2026-11-09T00:58:00Z' }) })).toBe(EMPTY_GLYPH);
    expect(emptyWindowText({ ...ok, status: 'NEEDS_CHECK' })).toBe(EMPTY_GLYPH);
    expect(emptyWindowText({ ...ok, status: 'RELOGIN_REQUIRED' })).toBe(EMPTY_GLYPH);
  });
});

describe('막대', () => {
  const later = '2026-11-09T03:00:00Z';
  test('색 — 100% 이상 destructive, 75% 이상 warning, 그 밖 primary', () => {
    expect(usageBarTone({ usedPercent: 74.99, resetsAt: later })).toBe('primary');
    expect(usageBarTone({ usedPercent: 75, resetsAt: later })).toBe('warning');
    expect(usageBarTone({ usedPercent: 99.99, resetsAt: later })).toBe('warning');
    expect(usageBarTone({ usedPercent: 100, resetsAt: later })).toBe('destructive');
    expect(usageBarTone({ usedPercent: 130, resetsAt: null })).toBe('destructive');
  });

  test('초기화 시각이 지난 창은 지난 값이라 경고 색 없이 muted', () => {
    expect(usageBarTone({ usedPercent: 100, resetsAt: '2026-11-09T00:59:00Z' })).toBe('muted');
    expect(usageBarTone({ usedPercent: 80, resetsAt: '2026-11-09T01:00:00Z' }, NOW)).toBe('muted');
    expect(isWindowReset({ resetsAt: '2026-11-09T00:59:00Z' }, NOW)).toBe(true);
    expect(isWindowReset({ resetsAt: '2026-11-09T01:01:00Z' }, NOW)).toBe(false);
    expect(isWindowReset({ resetsAt: null }, NOW)).toBe(false);
  });

  test('폭은 0~100 으로 자르고, 글자는 내림한 정수 %', () => {
    expect(usageBarWidth(130)).toBe(100);
    expect(usageBarWidth(-1)).toBe(0);
    expect(usageBarWidth(42.5)).toBe(42.5);
    expect(formatUsedPercent(74.99)).toBe('74%');
    expect(formatUsedPercent(104.2)).toBe('104%');
  });
});

describe('초기화 문구', () => {
  test('5시간 — N시간 M분 뒤 / M분 뒤 / 정시 / 지났으면 「초기화됨 · 다음 확인 때 갱신」 / 없으면 null', () => {
    expect(formatResetCountdown('2026-11-09T03:25:00Z', NOW)).toBe('2시간 25분 뒤 초기화');
    expect(formatResetCountdown('2026-11-09T01:40:00Z', NOW)).toBe('40분 뒤 초기화');
    expect(formatResetCountdown('2026-11-09T01:00:30Z', NOW)).toBe('1분 뒤 초기화');
    expect(formatResetCountdown('2026-11-09T04:00:00Z', NOW)).toBe('3시간 뒤 초기화');
    expect(formatResetCountdown('2026-11-09T00:59:00Z', NOW)).toBe('초기화됨 · 다음 확인 때 갱신');
    expect(formatResetCountdown('2026-11-09T01:00:00Z', NOW)).toBe(WINDOW_RESET_TEXT);
    expect(formatResetCountdown(null, NOW)).toBeNull();
  });

  test('주간 — 브라우저 시간대(KST)의 「M/D (요일) 오전·오후 H:MM 초기화」', () => {
    // 11/12 15:00Z = 11/13(금) 00:00 KST — UTC 날짜(11/12 목)가 아니라 KST 날짜로, 0시는 「오전 12:00」
    expect(formatWeeklyReset('2026-11-12T15:00:00Z')).toBe('11/13 (금) 오전 12:00 초기화');
    expect(formatWeeklyReset('2026-11-12T05:05:00Z')).toBe('11/12 (목) 오후 2:05 초기화');
    // 정각
    expect(formatWeeklyReset('2026-11-12T05:00:00Z')).toBe('11/12 (목) 오후 2:00 초기화');
    expect(formatWeeklyReset('2026-11-12T15:40:00Z')).toBe('11/13 (금) 오전 12:40 초기화');
    expect(formatWeeklyReset(null)).toBeNull();
  });

  test('주간 — 초기화 시각이 지났으면 지난 날짜 대신 「초기화됨 · 다음 확인 때 갱신」', () => {
    expect(formatWeeklyReset('2026-11-08T15:00:00Z', NOW)).toBe('초기화됨 · 다음 확인 때 갱신');
    expect(formatWeeklyReset('2026-11-12T15:00:00Z', NOW)).toBe('11/13 (금) 오전 12:00 초기화');
  });
});

describe('한도 없음·사용량 확인·마지막 사용 문구', () => {
  test('opencode·genia 또는 UNLIMITED 는 한도 없는 줄', () => {
    expect(isUnlimitedAccount({ provider: 'opencode', usage: null })).toBe(true);
    expect(isUnlimitedAccount({ provider: 'genia', usage: null })).toBe(true);
    expect(isUnlimitedAccount({ provider: 'anthropic', usage: usage({ status: 'UNLIMITED' }) })).toBe(true);
    expect(isUnlimitedAccount({ provider: 'chatgpt', usage: usage({ status: 'OK' }) })).toBe(false);
  });

  test('사용량 확인 칸 — 마지막 조회의 상대 시각, 조회 전·한도 없는 줄은 null', () => {
    expect(checkedText({ provider: 'anthropic', usage: usage({ checkedAt: '2026-11-09T00:58:00Z' }) })).toBe('2분 전');
    expect(checkedText({ provider: 'anthropic', usage: usage({ checkedAt: '2026-11-09T00:59:40Z' }) })).toBe('방금 전');
    expect(checkedText({ provider: 'anthropic', usage: usage() })).toBeNull();
    expect(checkedText({ provider: 'anthropic', usage: null })).toBeNull();
    // 한도 없는 줄은 조회하지 않는다 — checkedAt 이 있어도 「—」
    expect(checkedText({ provider: 'opencode', usage: usage({ checkedAt: '2026-11-09T00:58:00Z' }) })).toBeNull();
  });

  test('마지막 사용 — 「마지막 사용 N분 전」, 기록이 없으면 null(줄 생략)', () => {
    expect(lastUsedText(usage({ lastUsedAt: '2026-11-09T00:57:00Z' }))).toBe('마지막 사용 3분 전');
    expect(lastUsedText(usage({ lastUsedAt: '2026-11-09T00:59:40Z' }))).toBe('마지막 사용 방금 전');
    expect(lastUsedText(usage())).toBeNull();
    expect(lastUsedText(null)).toBeNull();
  });

  test('now 를 넘기면 그 시계로 센다 — 같은 줄의 초기화 문구와 한 시계', () => {
    const later = new Date('2026-11-09T01:10:00Z');
    expect(checkedText({ provider: 'anthropic', usage: usage({ checkedAt: '2026-11-09T00:58:00Z' }) }, later)).toBe('12분 전');
    expect(lastUsedText(usage({ lastUsedAt: '2026-11-09T00:57:00Z' }), later)).toBe('마지막 사용 13분 전');
  });
});
