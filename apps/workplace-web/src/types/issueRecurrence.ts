// 개인 작업 반복(WP-989) — /projects/{key}/issues/{number}/recurrence 응답·요청 DTO.

/** 반복 요약 — AI 위임 작업 목록 행(IssueResponse.recurrence)에 붙는 모양. */
export interface IssueRecurrenceSummary {
  /** RRULE — 예 FREQ=DAILY | FREQ=WEEKLY;BYDAY=MO,WE | FREQ=MONTHLY;BYMONTHDAY=15 */
  rrule: string;
  /** 실행 시각(한국 시간) 'HH:mm' */
  time: string;
  /** false 면 꺼짐(3회 연속 실패로 멈춤 등) */
  enabled: boolean;
}

/** 반복 단건 — GET/PUT 응답. 없으면 GET 이 204 다. */
export interface IssueRecurrence extends IssueRecurrenceSummary {
  /** 다음 회차 시각(ISO) — 꺼졌으면 null 일 수 있다. */
  nextRunAt: string | null;
  /** 연속 실패 횟수 — 3 이상이면 서버가 반복을 끈다. */
  consecutiveFailures: number;
  lastRunAt: string | null;
  /** 회차를 실행하는 AI(등록 당시 담당의 AI 비서). */
  agentUserId: number;
  agentName: string;
}

/** PUT 요청 본문. */
export interface PutIssueRecurrenceRequest {
  rrule: string;
  time: string;
}
