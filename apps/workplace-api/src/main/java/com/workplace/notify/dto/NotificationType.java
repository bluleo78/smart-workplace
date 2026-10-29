package com.workplace.notify.dto;

/**
 * 알림 종류 — DB 의 notification.type(VARCHAR) 과 name() 으로 매핑. ISSUE 계열(이슈 챗
 * AI_QUESTION·ISSUE_CHAT_MENTION, 코멘트 멘션 ISSUE_COMMENT_MENTION 포함)은 issue_id, REMINDER 는 event_id,
 * 노트 공유 계열(WIKI_*)은 wiki_page_id 를 채운다. AI 작업 상태로 생긴 알림(AI_REVIEW_REQUESTED·AI_WORK_FAILED, 상태 경로의
 * AI_QUESTION)은 agent_work_state 에 원인 상태를 남긴다(WP-913). DB 에 CHECK 제약이 없어 새 값 추가에 마이그레이션이 필요 없다.
 */
public enum NotificationType {
  ASSIGNED,
  COMMENTED,
  STATUS_CHANGED,
  PRIORITY_CHANGED, // 우선순위 변경(상태 변경과 대칭, 임계치 조건 없음, #613)
  REMINDER,
  CALENDAR_INVITED, // 일정 초대 수신(피초대자)
  CALENDAR_RSVP_CHANGED, // 참석자 RSVP 변경(주최자 수신)
  AI_QUESTION, // 이슈 챗에 AI 가 답변 필요 질문을 올림(WP-452) — 담당자·보고자·워처(HUMAN)·멘션된 사람·AI
  ISSUE_CHAT_MENTION, // 이슈 챗 글에서 멘션됨(WP-452) — 멘션된 사람·AI(WP-720)
  ISSUE_COMMENT_MENTION, // 이슈 코멘트에서 멘션됨(WP-650) — 멘션된 사람·AI(WP-720), comment_id 를 채운다
  WIKI_SHARED, // 노트 공유 대상으로 지정됨(WP-579) — 새로 추가된 사람. wiki_page_id·message 를 채운다
  WIKI_SHARE_ACCESS_REQUESTED, // 노트 접근 요청(WP-579) — 공유를 만든 사람
  WIKI_SHARE_ACCESS_APPROVED, // 노트 접근 요청 승인(WP-579) — 요청자
  CALENDAR_EVENT_UPDATED, // 주최자가 일정 시간·장소를 바꿈(WP-712) — 참석자 수신, event_id + 그때의 제목·새 시각
  CALENDAR_EVENT_CANCELED, // 주최자가 일정을 지움(WP-712) — 참석자 수신, event_id 없이 제목·원래 시각만
  // AI 작업이 검토 대기(REVIEW)로 바뀜(WP-913) — 그 AI 를 담당자로 지정한 사람(없거나 못 보면 보고자) 1명. agent_work_state=REVIEW
  AI_REVIEW_REQUESTED,
  // AI 작업이 실패·거절로 끝남(WP-913) — 수신자는 AI_REVIEW_REQUESTED 와 같다. agent_work_state=FAILED|REJECTED
  AI_WORK_FAILED,
  // 이슈 보고자로 지정됨(WP-944) — 새 보고자 1명. 설정은 「나에게 할당」 줄을 함께 쓴다
  REPORTER_ASSIGNED,
  // 주인이 아닌 사람(관리자)이 내 개인 비서의 AI 연결을 회수함(WP-1170) — 주인 1명. 정리 마이그레이션이 넣은 행은 actor 가 없다.
  // 내 비서가 멈춘 것을 알리는 계정 알림이라 알림 설정과 무관하게 늘 보낸다(설정 줄 없음)
  PERSONAL_ASSISTANT_REVOKED
}
