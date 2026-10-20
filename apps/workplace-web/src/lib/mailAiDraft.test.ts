// 새 메일 AI 초안(WP-576) 제목·되돌리기 규칙 단위 테스트.
import { describe, expect, it } from 'vitest';

import { composeDraftRequestSubject, nextUndoSnapshot, resolveDraftSubject, undoDraftSubject } from './mailAiDraft';

describe('composeDraftRequestSubject', () => {
  it('빈 제목(공백 포함)은 null — 서버가 제목을 만들어 준다', () => {
    expect(composeDraftRequestSubject('', null)).toBeNull();
    expect(composeDraftRequestSubject('   ', null)).toBeNull();
  });
  it('사용자가 쓴 제목은 그대로 보낸다', () => {
    expect(composeDraftRequestSubject('주간 보고', null)).toBe('주간 보고');
    expect(composeDraftRequestSubject('주간 보고', 'AI 제목')).toBe('주간 보고');
  });
  it('손대지 않은 지난 AI 제목은 null — 다시 쓰기 때 새 제목을 받는다', () => {
    expect(composeDraftRequestSubject('AI 제목', 'AI 제목')).toBeNull();
  });
});

describe('resolveDraftSubject', () => {
  const r = (now: string, atRequest: string, aiSubject: string | null, resultSubject: string | null) =>
    resolveDraftSubject({ now, atRequest, aiSubject, resultSubject });
  it('빈 제목이면 응답 제목으로 채우고 AI 제목으로 기억한다', () => {
    expect(r('', '', null, '회의 일정 변경')).toEqual({ subject: '회의 일정 변경', aiSubject: '회의 일정 변경' });
  });
  it('손대지 않은 AI 제목은 새 응답 제목으로 바꾼다', () => {
    expect(r('옛 제목', '옛 제목', '옛 제목', '새 제목')).toEqual({ subject: '새 제목', aiSubject: '새 제목' });
  });
  it('사용자가 쓴 제목은 응답에 제목이 와도 지킨다', () => {
    expect(r('내 제목', '내 제목', null, '다른 제목')).toEqual({ subject: '내 제목', aiSubject: null });
    // AI 제목을 사용자가 고쳤으면 더는 AI 제목이 아니다.
    expect(r('고친 제목', '고친 제목', 'AI 제목', '새 제목')).toEqual({ subject: '고친 제목', aiSubject: null });
  });
  it('생성 중 사용자가 제목을 쓰면(요청 때와 다름) 응답 제목으로 덮지 않는다', () => {
    expect(r('생성 중 쓴 제목', '', null, 'AI 제목')).toEqual({ subject: '생성 중 쓴 제목', aiSubject: null });
    // 손대지 않은 AI 제목을 생성 중 고친 경우도 마찬가지.
    expect(r('고침', '옛 AI', '옛 AI', '새 AI')).toEqual({ subject: '고침', aiSubject: null });
  });
  it('응답 제목이 없으면 지금 제목 그대로', () => {
    expect(r('', '', null, null)).toEqual({ subject: '', aiSubject: null });
    expect(r('AI 제목', 'AI 제목', 'AI 제목', null)).toEqual({ subject: 'AI 제목', aiSubject: 'AI 제목' });
  });
});

describe('undoDraftSubject', () => {
  it('지금 제목이 AI 가 넣은 제목 그대로면 생성 직전 제목으로', () => {
    expect(undoDraftSubject('AI 제목', 'AI 제목', '')).toBe('');
    expect(undoDraftSubject('AI 제목', 'AI 제목', '원래 제목')).toBe('원래 제목');
  });
  it('사용자가 AI 제목을 고쳤으면 고친 제목을 지킨다', () => {
    expect(undoDraftSubject('고친 제목', 'AI 제목', '')).toBe('고친 제목');
  });
  it('AI 가 제목을 넣지 않았으면 지금 제목 그대로', () => {
    expect(undoDraftSubject('내 제목', null, '내 제목')).toBe('내 제목');
    expect(undoDraftSubject('생성 뒤 쓴 제목', null, '')).toBe('생성 뒤 쓴 제목');
  });
});

describe('nextUndoSnapshot', () => {
  const original = { html: '<p>내 글</p>', subject: '' };
  const afterAi = { html: '<p>AI 초안</p>', subject: 'AI 제목' };
  it('처음 생성이면 생성 직전 모습', () => {
    expect(nextUndoSnapshot(null, false, original)).toBe(original);
  });
  it('손대지 않은 AI 초안을 다시 쓰면 맨 처음 모습을 유지', () => {
    expect(nextUndoSnapshot(original, true, afterAi)).toBe(original);
  });
  it('AI 초안을 고친 뒤(filled=false) 다시 만들면 고친 모습이 새 대상', () => {
    expect(nextUndoSnapshot(original, false, afterAi)).toBe(afterAi);
  });
});
