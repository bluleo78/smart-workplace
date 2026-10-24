// 백엔드 NotificationResponse 와 1:1 매칭.
export interface NotificationResponse {
  id: number;
  type:
    | "ASSIGNED"
    | "COMMENTED"
    | "STATUS_CHANGED"
    | "PRIORITY_CHANGED"
    | "REMINDER"
    | "CALENDAR_INVITED"
    | "CALENDAR_RSVP_CHANGED"
    // WP-452: 이슈 챗 알림 — AI 가 답변 필요 질문을 올림 / 이슈 챗 글에서 나를 멘션.
    | "AI_QUESTION"
    | "ISSUE_CHAT_MENTION"
    // WP-650: 이슈 코멘트에서 나를 멘션.
    | "ISSUE_COMMENT_MENTION"
    // WP-579: 노트 공유 알림 — 공유받음 / 접근 요청(공유한 사람) / 접근 승인(요청자). wikiPageId 를 채운다.
    | "WIKI_SHARED"
    | "WIKI_SHARE_ACCESS_REQUESTED"
    | "WIKI_SHARE_ACCESS_APPROVED"
    // WP-712: 주최자가 일정 시간·장소를 바꿈 / 일정을 지움 — 참석자 수신. 취소는 eventId 없이 제목·원래 시각만.
    | "CALENDAR_EVENT_UPDATED"
    | "CALENDAR_EVENT_CANCELED";
  actorId: number | null;
  actorName: string | null;
  actorKind: string | null; // 'HUMAN' | 'AGENT' | null
  issueId: number;
  projectKey: string;
  issueNumber: number;
  issueTitle: string;
  commentId: number | null;
  // 일정 알림(REMINDER·CALENDAR_*) 전용 — 일정 알림 정보 (이슈 #110, #489). 그 외 타입에선 null.
  // 변경·취소 알림(WP-712)은 알림 때의 제목·시각이고, 취소면 eventId 가 null(지운 일정)이다.
  eventId: number | null;
  eventTitle: string | null;
  eventStartsAt: string | null;
  // WP-579 노트 공유 알림 전용 — 그 외 타입에선 null. 이전 서버(롤링 배포 중)가 필드를 안 보내도 안전하도록 optional.
  wikiPageId?: number | null;
  wikiPageTitle?: string | null;
  message?: string | null; // 공유한 사람이 덧붙인 메시지(WIKI_SHARED)
  // STATUS_CHANGED 알림의 새 상태 이름(WP-869) — 이름을 남기기 전 알림·그 외 유형·구 서버면 없다(기존 문구로 폴백).
  statusName?: string | null;
  read: boolean;
  createdAt: string;
}
