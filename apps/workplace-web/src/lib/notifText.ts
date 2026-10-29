// 인박스 알림 동작 문구 — 행위자 이름 뒤에 붙는 부분(InboxList). 순수 함수라 vitest 로 지킨다(WP-869).
import type { NotificationResponse } from '@/types/notification';

import { directionParticle } from './utils';

// 알림 종류별 동작 문구(액터명 뒤에 붙는다).
export const ACTION_LABEL: Record<NotificationResponse['type'], string> = {
  ASSIGNED: '님이 회원님을 배정했습니다',
  REPORTER_ASSIGNED: '님이 회원님을 보고자로 지정했습니다', // WP-944
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
  // WP-913 AI 위임 작업 알림 — 서버 푸시 문구(PushContentService)와 같다. 실패·거절은 agentWorkState 로 갈린다(notificationAction).
  AI_REVIEW_REQUESTED: '님이 검토를 요청했습니다',
  AI_WORK_FAILED: '님이 작업에 실패했습니다',
  // WP-1170 내 개인 비서 연결 해제 — 행위자(관리자)가 없으면(일회성 정리) InboxList 가 PERSONAL_ASSISTANT_REVOKED_NO_ACTOR 를 쓴다.
  PERSONAL_ASSISTANT_REVOKED: '님이 내 개인 비서의 AI 연결을 해제했어요 — 다시 연결해 주세요',
};

// 행위자 없는 개인 비서 연결 해제 문구(WP-1170) — 일회성 정리가 해제해 actor 가 null 인 알림.
export const PERSONAL_ASSISTANT_REVOKED_NO_ACTOR = '내 개인 비서의 AI 연결이 해제됐어요 — 다시 연결해 주세요';

// AI 작업 상태 → 문구(WP-913) — 종류 기본 문구(ACTION_LABEL)와 다른 상태만 둔다. 검토 대기(REVIEW)·실패(FAILED)·모르는 상태·상태 없음은
// 종류 문구로 떨어진다(AI 질문은 「이슈 챗에서 질문」, 실패 알림은 「작업에 실패」). 서버 PushContentService 의 같은 이름 표와 같다.
const AGENT_WORK_STATE_LABEL: Partial<Record<string, string>> = {
  REJECTED: '님이 작업을 거절했습니다',
  INPUT_REQUIRED: '님이 답변을 기다리고 있습니다',
  AUTH_REQUIRED: '님이 권한이 필요하다고 알렸습니다',
  BLOCKED: '님이 작업이 막혔다고 알렸습니다',
};

// 종류별로 상태 문구를 쓰는 상태 — 표에 없는 종류·상태 조합(검토 요청 전부, 실패의 FAILED·모르는 상태, 다른 종류)은 종류 문구 그대로.
// 엇갈린 조합(실패 알림에 BLOCKED 등)이 다른 종류의 문구를 빌려 쓰지 않게 막는다. 서버 PushContentService.STATE_LABEL_ALLOWED 와 같다.
const STATE_LABEL_ALLOWED: Partial<Record<NotificationResponse['type'], readonly string[]>> = {
  AI_WORK_FAILED: ['REJECTED'],
  AI_QUESTION: ['INPUT_REQUIRED', 'AUTH_REQUIRED', 'BLOCKED'],
};

/**
 * 이슈 알림 동작 문구 — 상태 변경이고 서버가 새 상태 이름(statusName)을 실었으면 「님이 상태를 '검토 중'으로 변경했습니다」,
 * 아니면(구 서버·이전 알림·다른 종류) 종류별 기본 문구. 조사는 이름 끝 글자 받침으로 고르고, 알 수 없으면 「(으)로」.
 * AI 작업 알림(WP-913)은 agentWorkState 로 문구를 고른다(AGENT_WORK_STATE_LABEL, 없으면 종류 문구). 서버 푸시와 같은 문구여야
 * 같은 알림이 화면마다 다르게 읽히지 않는다.
 */
export function notificationAction(n: NotificationResponse): string {
  if (n.type === 'STATUS_CHANGED' && n.statusName) {
    return `님이 상태를 '${n.statusName}'${directionParticle(n.statusName)} 변경했습니다`;
  }
  const state = n.agentWorkState;
  const byState = state && STATE_LABEL_ALLOWED[n.type]?.includes(state) ? AGENT_WORK_STATE_LABEL[state] : undefined;
  return byState ?? ACTION_LABEL[n.type];
}
