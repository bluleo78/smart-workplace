// 7c: 홈 compose/위젯 계약. 백엔드 HomeComposeResponse·ActivityEntryResponse 와 1:1.

// 위젯 타입(WidgetLayout/WidgetType/WidgetSpec)은 AI 비서 응답(show_* 도구)이 지시하는
// 표시 위젯 계약이다. #431 에서 챗 도크 인라인 렌더로 부활(chatWidgetRegistry).
// compose done 이벤트의 widgets[] 및 복원용 HomeMessage.widgets 가 이 형태를 따른다.

/** 위젯 캔버스 배치 힌트 (compose 응답). fire-hub canvas 스키마 미러. */
export interface WidgetLayout {
  page?: 'new' | 'current';
  replace?: string; // 교체 대상 위젯 id
  pageLabel?: string; // page='new' 일 때 새 페이지 라벨
}

export type WidgetType = 'my_tasks' | 'issue_list' | 'issue_detail' | 'activity' | 'mail_list' | 'calendar' | 'event' | 'channels' | 'wiki' | 'wiki_page' | 'contacts' | 'contact' | 'projects' | 'project' | 'drive';

/** compose 가 돌려주는 위젯 스펙. params 는 위젯별 자유 형태(이슈 검색 필터 등). */
export interface WidgetSpec {
  type: WidgetType;
  params?: Record<string, unknown>;
  layout?: WidgetLayout;
}

export interface ChatRequest {
  sessionId: string | null;
  query: string;
}

/** AI 도구 호출/위임 단계 — 어시스턴트 턴 인라인 표시 + 복원. */
export interface ToolStep {
  kind: 'delegation' | 'tool';
  label?: string; // delegation
  seq?: number; // tool — start/result 매칭
  toolName?: string; // tool
  args?: Record<string, unknown>; // tool
  status?: 'running' | 'done' | 'error'; // tool
}

/** compose 의 라이브 tool SSE 이벤트(start/result). */
export interface ToolEventDto {
  seq: number;
  phase: 'start' | 'result';
  toolName: string;
  args?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * #463: 어시스턴트 응답 인터리브 블록 — 텍스트 델타와 위젯이 도착 순서를 유지하도록
 * 배열로 누적된다. 텍스트 블록은 content 슬라이스 오프셋(textStart)만 보유해 불변 문자열
 * 복사 없이 ChatTurn.content 를 공유한다.
 */
export type ContentBlock =
  | { kind: 'text'; textStart: number }
  | { kind: 'widget'; widget: WidgetSpec };

/** 챗 말풍선 한 턴. (챗 세션 훅이 transcript 로 사용) */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** #431: AI 응답이 지시한 표시 위젯(이슈/메일 목록 등). 챗 도크가 인라인 렌더. */
  widgets?: WidgetSpec[];
  /** AI 도구 호출/위임 단계(인라인 표시). */
  steps?: ToolStep[];
  /** #463: 도착 순 인터리브 블록(텍스트/위젯). Task 6 렌더러가 소비. */
  contentBlocks?: ContentBlock[];
}

/** 세션 스위처 목록 항목 (GET /home/sessions). */
export interface HomeSessionSummary {
  id: string;
  title: string;
  lastMessageAt: string; // ISO 8601
  widgetCount: number;
}

/** 세션 목록 페이지(커서 페이지네이션). */
export interface HomeSessionPage {
  items: HomeSessionSummary[];
  nextCursor: string | null;
}

/** 복원용 메시지 (GET /home/sessions/{id}/messages). ASSISTANT 의 widgets 가 캔버스 복원 원천. */
export interface HomeMessage {
  id: number;
  role: 'USER' | 'ASSISTANT';
  content: string;
  widgets: WidgetSpec[] | null;
  toolCalls: ToolStep[] | null;
  createdAt: string; // ISO 8601
}

export type ActorKind = 'HUMAN' | 'AGENT';

/** GET /api/v1/me/activity 항목. */
export interface ActivityEntry {
  id: number;
  issueId: number;
  projectKey: string;
  issueNumber: number;
  issueTitle: string;
  actorId: number;
  actorName: string;
  actorKind: ActorKind;
  eventType: string;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEntry[];
  nextCursor: string | null;
}

/**
 * #333 M2: AI 에이전트가 외부 액션 실행 전 사용자 확인을 요청하는 제안 객체.
 * 도크의 승인/취소 카드가 이 타입을 기반으로 렌더된다.
 */
export interface PendingAction {
  /** 액션 식별자. 예: 'calendar.create_event', 'issue.assign' */
  actionType: string;
  /** 사람이 읽을 수 있는 액션 요약 (카드 본문). */
  summary: string;
  /** confirm 요청 시 그대로 재전송할 파라미터 페이로드. */
  params: Record<string, unknown>;
}
