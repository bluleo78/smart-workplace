// 인박스 알림 동작 문구 — 행위자 이름 뒤에 붙는 부분(InboxList). 순수 함수라 vitest 로 지킨다(WP-869).
import type { NotificationResponse } from '@/types/notification';

import { directionParticle } from './utils';

// 알림 종류별 동작 문구(액터명 뒤에 붙는다).
export const ACTION_LABEL: Record<NotificationResponse['type'], string> = {
  ASSIGNED: '님이 회원님을 배정했습니다',
  COMMENTED: '님이 코멘트를 남겼습니다',
  STATUS_CHANGED: '님이 상태를 변경했습니다',
  PRIORITY_CHANGED: '님이 우선순위를 변경했습니다',
  // REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED 는 InboxList 의 별도 분기(isCalendarType)로 렌더.
  REMINDER: '일정 알림',
  CALENDAR_INVITED: '님이 일정에 초대했습니다',
  CALENDAR_RSVP_CHANGED: '님이 참석 응답을 변경했습니다',
  // WP-452 이슈 챗 알림 — 클릭하면 이슈 챗 드로워가 열린 이슈 상세로 간다(notifTarget).
  AI_QUESTION: '님이 이슈 챗에서 질문했습니다',
  ISSUE_CHAT_MENTION: '님이 이슈 챗에서 회원님을 멘션했습니다',
  // WP-650 코멘트 멘션 — 클릭하면 그 이슈 상세로 간다(챗 드로워 없이).
  ISSUE_COMMENT_MENTION: '님이 코멘트에서 회원님을 멘션했습니다',
  // WP-579 노트 공유 알림 — 노트 제목이 들어간 실제 문구는 wikiShareText 가 만든다(이 값은 타입 완결용 기본 문구).
  WIKI_SHARED: '님이 노트를 공유했습니다',
  WIKI_SHARE_ACCESS_REQUESTED: '님이 접근을 요청했습니다',
  WIKI_SHARE_ACCESS_APPROVED: '접근이 승인됐습니다',
  // WP-712 주최자의 일정 변경(시간·장소)·취소 — 일정 제목·시각은 아래 줄에 함께 보인다.
  CALENDAR_EVENT_UPDATED: '님이 일정을 변경했습니다',
  CALENDAR_EVENT_CANCELED: '님이 일정을 취소했습니다',
};

/**
 * 이슈 알림 동작 문구 — 상태 변경이고 서버가 새 상태 이름(statusName)을 실었으면 「님이 상태를 '검토 중'으로 변경했습니다」,
 * 아니면(구 서버·이전 알림·다른 종류) 종류별 기본 문구. 조사는 이름 끝 글자 받침으로 고르고, 알 수 없으면 「(으)로」.
 */
export function notificationAction(n: NotificationResponse): string {
  if (n.type === 'STATUS_CHANGED' && n.statusName) {
    return `님이 상태를 '${n.statusName}'${directionParticle(n.statusName)} 변경했습니다`;
  }
  return ACTION_LABEL[n.type];
}
