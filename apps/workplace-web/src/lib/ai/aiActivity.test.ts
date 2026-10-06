import { describe, expect, it } from 'vitest';

import { aiActivity, aiTriggerLabel, sessionListLabel } from './aiActivity';

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

describe('sessionListLabel', () => {
  it('다른 대화 상태를 접근 이름에 덧붙인다', () => {
    expect(sessionListLabel('대화 목록', 'pending')).toBe('대화 목록, 다른 대화 답변 중');
    expect(sessionListLabel('대화 목록', 'done')).toBe('대화 목록, 다른 대화에 새 답변');
    expect(sessionListLabel('대화 목록', 'idle')).toBe('대화 목록');
  });
});
