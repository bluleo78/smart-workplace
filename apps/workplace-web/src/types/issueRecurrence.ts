// 이슈 반복(WP-989, 화면 이름 「실행 일정」) — /projects/{key}/issues/{number}/recurrence 응답·요청 DTO.
// WP-1314: 팀 이슈에도 쓰고 담당 AI 를 고른다.

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
  /** 회차를 실행하는 담당 AI. */
  agentUserId: number;
  agentName: string;
  /** 보는 사람이 고치거나 끌 수 있는지(WP-1314) — 담당 AI 가 남의 개인 비서면 주인만 할 수 있어 false. 구버전 서버는 빠진다(=true). */
  editable?: boolean;
  /** 「지금 실행」(테스트 실행, WP-1313)의 결과를 기다리는 중인지 — 버튼을 「실행 중」으로 잠근다. 구버전 서버는 빠진다(=false). */
  testRunning?: boolean;
}

/** 실행 일정의 담당 AI 후보(WP-1314) — GET …/recurrence/agents. 남의 개인 비서는 오지 않는다. */
export interface IssueRecurrenceAgentOption {
  id: number;
  username: string;
  name: string | null;
  /** 보는 사람의 개인 비서인지 — 목록 맨 앞에 오고 「내 AI 비서」로 표시한다. */
  personalAssistant: boolean;
}

/** PUT 요청 본문. */
export interface PutIssueRecurrenceRequest {
  rrule: string;
  time: string;
  /** 담당 AI(WP-1314) — 없으면 서버가 정한다(개인 작업은 소유자의 AI 비서). */
  agentUserId?: number;
}
