// 인박스 알림 동작 문구(WP-869) — 상태 변경 알림은 새 상태 이름을, 이름이 없으면(구 서버·이전 알림) 기존 문구를 쓴다.
import { describe, expect, it } from 'vitest';

import type { NotificationResponse } from '@/types/notification';

import { notificationAction, PERSONAL_ASSISTANT_REVOKED_NO_ACTOR } from './notifText';

const n = (over: Partial<NotificationResponse>) => ({ type: 'STATUS_CHANGED', ...over }) as NotificationResponse;

describe('notificationAction', () => {
  it('상태 이름이 있으면 받침에 맞는 조사로 그 이름을 보인다', () => {
    expect(notificationAction(n({ statusName: '검토 중' }))).toBe("님이 상태를 '검토 중'으로 변경했습니다");
    expect(notificationAction(n({ statusName: '완료' }))).toBe("님이 상태를 '완료'로 변경했습니다");
    // 받침을 알 수 없는 끝 글자(영문·숫자)는 「(으)로」.
    expect(notificationAction(n({ statusName: 'QA' }))).toBe("님이 상태를 'QA'(으)로 변경했습니다");
  });

  it('상태 이름이 없으면 기존 문구', () => {
    expect(notificationAction(n({ statusName: null }))).toBe('님이 상태를 변경했습니다');
    expect(notificationAction(n({}))).toBe('님이 상태를 변경했습니다');
  });

  it('다른 종류는 종류별 문구 그대로', () => {
    expect(notificationAction(n({ type: 'COMMENTED', statusName: '완료' }))).toBe('님이 코멘트를 남겼습니다');
  });
});

// WP-913 — AI 작업 알림은 서버 푸시와 같은 문구를 쓴다. AI_QUESTION·AI_WORK_FAILED 는 agentWorkState 로 문구를 고른다.
describe('notificationAction — AI 작업 알림 (WP-913)', () => {
  it('검토 요청·실패·거절', () => {
    expect(notificationAction(n({ type: 'AI_REVIEW_REQUESTED', agentWorkState: 'REVIEW' }))).toBe('님이 검토를 요청했습니다');
    expect(notificationAction(n({ type: 'AI_WORK_FAILED', agentWorkState: 'FAILED' }))).toBe('님이 작업에 실패했습니다');
    expect(notificationAction(n({ type: 'AI_WORK_FAILED', agentWorkState: 'REJECTED' }))).toBe('님이 작업을 거절했습니다');
  });

  it('실패 알림의 상태가 없거나 모르는 값이면 실패 문구', () => {
    expect(notificationAction(n({ type: 'AI_WORK_FAILED', agentWorkState: null }))).toBe('님이 작업에 실패했습니다');
    expect(notificationAction(n({ type: 'AI_WORK_FAILED' }))).toBe('님이 작업에 실패했습니다');
    expect(notificationAction(n({ type: 'AI_WORK_FAILED', agentWorkState: 'WHATEVER' }))).toBe('님이 작업에 실패했습니다');
  });

  it('AI 질문은 상태별 문구, 상태가 없으면 기존 문구', () => {
    expect(notificationAction(n({ type: 'AI_QUESTION', agentWorkState: null }))).toBe('님이 이슈 챗에서 질문했습니다');
    expect(notificationAction(n({ type: 'AI_QUESTION' }))).toBe('님이 이슈 챗에서 질문했습니다');
    expect(notificationAction(n({ type: 'AI_QUESTION', agentWorkState: 'INPUT_REQUIRED' }))).toBe('님이 답변을 기다리고 있습니다');
    expect(notificationAction(n({ type: 'AI_QUESTION', agentWorkState: 'AUTH_REQUIRED' }))).toBe('님이 권한이 필요하다고 알렸습니다');
    expect(notificationAction(n({ type: 'AI_QUESTION', agentWorkState: 'BLOCKED' }))).toBe('님이 작업이 막혔다고 알렸습니다');
  });

  it('다른 종류는 상태가 있어도 종류별 문구', () => {
    expect(notificationAction(n({ type: 'COMMENTED', agentWorkState: 'BLOCKED' }))).toBe('님이 코멘트를 남겼습니다');
    // 종류에 맞지 않는 상태는 종류 문구 그대로(다른 종류의 상태 문구를 빌려 쓰지 않는다).
    expect(notificationAction(n({ type: 'AI_WORK_FAILED', agentWorkState: 'BLOCKED' }))).toBe('님이 작업에 실패했습니다');
    expect(notificationAction(n({ type: 'AI_REVIEW_REQUESTED', agentWorkState: 'REJECTED' }))).toBe('님이 검토를 요청했습니다');
  });
});

// WP-1170 — 개인 비서 연결 해제: 행위자(관리자) 이름 뒤에 붙는 문구와, 행위자 없는(일회성 정리) 문구.
describe('개인 비서 연결 해제 문구 (WP-1170)', () => {
  it('행위자가 있으면 이름 뒤에 붙는 해제 문구', () => {
    expect(notificationAction(n({ type: 'PERSONAL_ASSISTANT_REVOKED', actorName: '김관리' }))).toBe(
      '님이 내 개인 비서의 AI 연결을 해제했어요 — 다시 연결해 주세요',
    );
  });

  it('행위자 없는 문구는 주어 없이 해제됐다고 알린다', () => {
    expect(PERSONAL_ASSISTANT_REVOKED_NO_ACTOR).toBe('내 개인 비서의 AI 연결이 해제됐어요 — 다시 연결해 주세요');
  });
});
