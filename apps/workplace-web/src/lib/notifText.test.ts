// 인박스 알림 동작 문구(WP-869) — 상태 변경 알림은 새 상태 이름을, 이름이 없으면(구 서버·이전 알림) 기존 문구를 쓴다.
import { describe, expect, it } from 'vitest';

import type { NotificationResponse } from '@/types/notification';

import { notificationAction } from './notifText';

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
