package com.workplace.notify.dto;

/**
 * 알림 종류 — DB 의 notification.type(VARCHAR) 과 name() 으로 매핑. ISSUE 계열(이슈 챗
 * AI_QUESTION·ISSUE_CHAT_MENTION, 코멘트 멘션 ISSUE_COMMENT_MENTION 포함)은 issue_id, REMINDER 는 event_id,
 * 노트 공유 계열(WIKI_*)은 wiki_page_id 를 채운다. DB 에 CHECK 제약이 없어 새 값 추가에 마이그레이션이 필요 없다.
 */
public enum NotificationType {
  ASSIGNED,
  COMMENTED,
  STATUS_CHANGED,
  PRIORITY_CHANGED, // 우선순위 변경(상태 변경과 대칭, 임계치 조건 없음, #613)
  REMINDER,
  CALENDAR_INVITED, // 일정 초대 수신(피초대자)
  CALENDAR_RSVP_CHANGED, // 참석자 RSVP 변경(주최자 수신)
  AI_QUESTION, // 이슈 챗에 AI 가 답변 필요 질문을 올림(WP-452) — 담당자·보고자·워처·멘션된 사람(HUMAN)
  ISSUE_CHAT_MENTION, // 이슈 챗 글에서 멘션됨(WP-452) — 멘션된 사람(HUMAN)
  ISSUE_COMMENT_MENTION, // 이슈 코멘트에서 멘션됨(WP-650) — 멘션된 사람(HUMAN), comment_id 를 채운다
  WIKI_SHARED, // 노트 공유 대상으로 지정됨(WP-579) — 새로 추가된 사람. wiki_page_id·message 를 채운다
  WIKI_SHARE_ACCESS_REQUESTED, // 노트 접근 요청(WP-579) — 공유를 만든 사람
  WIKI_SHARE_ACCESS_APPROVED, // 노트 접근 요청 승인(WP-579) — 요청자
  CALENDAR_EVENT_UPDATED, // 주최자가 일정 시간·장소를 바꿈(WP-712) — 참석자 수신, event_id + 그때의 제목·새 시각
  CALENDAR_EVENT_CANCELED // 주최자가 일정을 지움(WP-712) — 참석자 수신, event_id 없이 제목·원래 시각만
}
