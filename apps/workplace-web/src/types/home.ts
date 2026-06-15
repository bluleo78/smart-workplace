// 7c: 홈 compose/위젯 계약. 백엔드 HomeComposeResponse·ActivityEntryResponse 와 1:1.

// 아래 위젯 타입(WidgetLayout/WidgetType/WidgetSpec)은 레거시 캔버스 잔재다.
// 캔버스 UI 는 제거됐지만 백엔드 메시지 DTO(HomeMessage.widgets)·compose 응답에 필드가
// 남아 있어, 타입 호환을 위해 형태만 유지한다(프론트에서 렌더에 쓰지 않음).

/** 위젯 캔버스 배치 힌트 (compose 응답). fire-hub canvas 스키마 미러. */
export interface WidgetLayout {
  page?: 'new' | 'current';
  replace?: string; // 교체 대상 위젯 id
  pageLabel?: string; // page='new' 일 때 새 페이지 라벨
}

export type WidgetType = 'my_tasks' | 'issue_list' | 'issue_detail' | 'activity';

/** compose 가 돌려주는 위젯 스펙. params 는 위젯별 자유 형태(이슈 검색 필터 등). */
export interface WidgetSpec {
  type: WidgetType;
  params?: Record<string, unknown>;
  layout?: WidgetLayout;
}

export interface ComposeRequest {
  sessionId: string | null;
  query: string;
}

export interface ComposeResponse {
  sessionId: string;
  message: string;
  /** 레거시 캔버스 위젯 스펙 — 더 이상 프론트에서 읽지 않는다(캔버스 제거). 응답에 남아 있어도 무시. */
  widgets?: WidgetSpec[];
}

/** 챗 말풍선 한 턴. (챗 세션 훅이 transcript 로 사용) */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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
