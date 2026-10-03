import { describe, expect, it } from 'vitest';

import { aiActivity, aiTriggerLabel, nextUnseenDone } from './aiActivity';

describe('nextUnseenDone', () => {
  const base = { prevPending: false, pending: false, open: false, unseenDone: false };
  it('닫힌 상태에서 생성 중 → 끝남이면 완료 표시', () => {
    expect(nextUnseenDone({ ...base, prevPending: true, pending: false })).toBe(true);
  });
  it('열려 있으면 항상 해제', () => {
    expect(nextUnseenDone({ ...base, prevPending: true, pending: false, open: true, unseenDone: true })).toBe(false);
  });
  it('변화가 없으면 이전 값 유지', () => {
    expect(nextUnseenDone({ ...base, unseenDone: true })).toBe(true);
    expect(nextUnseenDone(base)).toBe(false);
  });
  it('새 생성이 시작돼도(false→true) 완료 표시는 유지 — 표시 우선순위는 aiActivity 가 정한다', () => {
    expect(nextUnseenDone({ ...base, pending: true, unseenDone: true })).toBe(true);
  });
});

describe('aiActivity', () => {
  it('생성 중이 완료보다 우선', () => {
    expect(aiActivity(true, true)).toBe('pending');
    expect(aiActivity(false, true)).toBe('done');
    expect(aiActivity(false, false)).toBe('idle');
  });
});

describe('aiTriggerLabel', () => {
  it('상태를 접근 이름에 덧붙인다', () => {
    expect(aiTriggerLabel('AI 비서', 'idle')).toBe('AI 비서');
    expect(aiTriggerLabel('AI 비서', 'pending')).toBe('AI 비서, 답변 생성 중');
    expect(aiTriggerLabel('AI 비서', 'done')).toBe('AI 비서, 새 답변');
  });
});
