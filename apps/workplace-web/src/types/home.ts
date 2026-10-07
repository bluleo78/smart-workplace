// 7c: 홈 AI chat/위젯 계약. 백엔드 HomeComposeResponse·ActivityEntryResponse 와 1:1.

import type { AiScreenContext } from './aiScreenContext';

// 위젯 타입(WidgetLayout/WidgetType/WidgetSpec)은 AI 비서 응답(show_* 도구)이 지시하는
// 표시 위젯 계약이다. #431 에서 챗 도크 인라인 렌더로 부활(chatWidgetRegistry).
// AI chat done 이벤트의 widgets[] 및 복원용 HomeMessage.widgets 가 이 형태를 따른다.

/** 위젯 캔버스 배치 힌트 (AI chat 응답). fire-hub canvas 스키마 미러. */
export interface WidgetLayout {
  page?: 'new' | 'current';
  replace?: string; // 교체 대상 위젯 id
  pageLabel?: string; // page='new' 일 때 새 페이지 라벨
}

export type WidgetType = 'my_tasks' | 'issue_list' | 'issue_detail' | 'activity' | 'mail_list' | 'calendar' | 'event' | 'channels' | 'wiki' | 'wiki_page' | 'contacts' | 'contact' | 'projects' | 'project' | 'drive';

/** AI chat 이 돌려주는 위젯 스펙. params 는 위젯별 자유 형태(이슈 검색 필터 등). */
export interface WidgetSpec {
  type: WidgetType;
  params?: Record<string, unknown>;
  layout?: WidgetLayout;
}

export interface ChatRequest {
  sessionId: string | null;
  /** WP-234: 첨부만 보내면 빈 문자열(서버가 fileIds 가 있을 때만 허용). */
  query: string;
  /** WP-267: 웹이 정한 생성 id(UUID) — 응답보다 먼저 온 home.chat.* 이벤트도 바로 그 대화에 붙인다. */
  correlationId: string;
  /** WP-54: 현재 화면 컨텍스트 — 없으면 키 자체를 생략한다. */
  screenContext?: AiScreenContext;
  /** WP-234: 미리 올린 첨부(POST /home/attachments 응답의 fileId). 없으면 키 생략. */
  fileIds?: number[];
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

/** AI chat 의 라이브 tool SSE 이벤트(start/result). */
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
  | { kind: 'widget'; widget: WidgetSpec }
  // WP-157: 연속 도구 호출/위임 그룹 — steps[stepStart ~ 다음 tools 블록의 stepStart) 구간을 한 풍선으로 렌더.
  | { kind: 'tools'; stepStart: number };

/** #843: 확인카드 처리 결과 종류 — 대화 이력의 ACTION_* 메시지와 1:1. */
export type ActionOutcome = 'done' | 'failed' | 'rejected';

/**
 * 챗 transcript 한 턴. 대화 말풍선(user/assistant) 또는 확인카드 처리 결과 줄(action, #843).
 * 판별 유니온이라 role='action' 이면 outcome 이 항상 있다.
 */
export type ChatTurn = MessageTurn | ActionTurn;

/** #843: 확인카드 처리 결과 — 말풍선이 아니라 한 줄 시스템 기록으로 렌더. */
export interface ActionTurn {
  role: 'action';
  outcome: ActionOutcome;
  content: string;
}

/** 챗 말풍선 한 턴. (챗 세션 훅이 transcript 로 사용) */
export interface MessageTurn {
  role: 'user' | 'assistant';
  content: string;
  /** #431: AI 응답이 지시한 표시 위젯(이슈/메일 목록 등). 챗 도크가 인라인 렌더. */
  widgets?: WidgetSpec[];
  /** AI 도구 호출/위임 단계(인라인 표시). */
  steps?: ToolStep[];
  /** #463: 도착 순 인터리브 블록(텍스트/위젯/도구 그룹 — WP-157). AIChatPanel 이 블록 순서대로 렌더. */
  contentBlocks?: ContentBlock[];
  /** WP-234: 사용자 턴 첨부 — 보낸 직후(낙관적)엔 로컬 미리보기 포함, 복원 시엔 서버 첨부. */
  attachments?: TurnAttachment[];
  /**
   * WP-190: 정지(stopped)·오류(failed)·시간 초과(timeout)로 끝난 답변 — 본문 아래 "중단됨"/"오류로 중단됨"/"시간 초과로 중단됨".
   * timeout 은 라이브 종결(home.chat.cancelled{reason:'timeout'})에만 쓴다 — 저장된 STOPPED 는 다시 열면 "중단됨" 이다(스펙).
   */
  interrupted?: 'stopped' | 'failed' | 'timeout';
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
  /** ACTION_* = 확인카드 처리 결과(#843). 다음 턴 AI 맥락에도 포함된다. */
  role: 'USER' | 'ASSISTANT' | 'ACTION_DONE' | 'ACTION_FAILED' | 'ACTION_REJECTED';
  /** WP-234: 첨부만 보낸 USER 메시지는 비어(null) 있을 수 있다. */
  content: string | null;
  widgets: WidgetSpec[] | null;
  toolCalls: ToolStep[] | null;
  /** WP-158: 표시 블록 순서(ASSISTANT 전용). 없으면(이전 메시지·순서 재현 불가) 폴백 렌더. */
  contentBlocks?: ContentBlock[] | null;
  /** WP-234: 이 메시지에 붙은 첨부(USER). 서버는 없으면 빈 배열 — 구버전 응답·E2E 픽스처 호환을 위해 선택 필드. */
  attachments?: HomeAttachment[];
  /** WP-190: 답변 종결 상태. 구 API 응답엔 없을 수 있다. */
  status?: 'COMPLETE' | 'STOPPED' | 'FAILED';
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
  /** #843: 서버 영속 제안 id — 승인/거부는 이 id 로 한다(params 를 다시 보내지 않음). */
  id: number;
  /** 액션 식별자. 예: 'calendar.create_event', 'issue.assign' */
  actionType: string;
  /** 사람이 읽을 수 있는 액션 요약 (카드 본문). */
  summary: string;
  /** 실행 파라미터(서버 보관 원본 — 승인은 id 로 하므로 재전송하지 않는다). */
  params: Record<string, unknown>;
}

/** #843: 확인카드 화면 상태 — submitting 중엔 버튼 잠금, failed 는 사유를 카드 안에 표시. 완료(done)된 카드는 목록에서 빠진다. */
export type ProposalPhase = 'pending' | 'submitting' | 'failed';

/** 화면용 확인카드 = 서버 제안 + 로컬 진행 상태. */
export interface ProposalCard extends PendingAction {
  phase: ProposalPhase;
  /** phase='failed' 일 때 사용자·AI 에게 보이는 실패 사유. */
  error?: string;
}

/** 확인카드 승인/거부 응답(POST /home/proposals/{id}/confirm|reject). 실행 실패도 200 + proposal.status=FAILED. */
export interface ProposalOutcome {
  proposal: PendingAction & {
    sessionId: string;
    status: 'PENDING' | 'DONE' | 'FAILED' | 'REJECTED' | 'EXPIRED';
    errorMessage: string | null;
  };
  /** 대화 이력에 추가된 결과 메시지(role=ACTION_*). */
  message: HomeMessage;
}

/** WP-234: POST /home/attachments 응답 항목 — 이슈 챗 업로드(UploadedFile)와 같은 모양. */
export interface HomeUploadedFile {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

/** WP-234: 첨부 텍스트 추출 상태 — 백엔드 ExtractionInfo(WP-242 공통 계약)와 1:1. */
export interface ExtractionInfo {
  status: 'PENDING' | 'READY' | 'SKIPPED' | 'FAILED' | 'NONE';
  /** READY 일 때 전체 글자 수. */
  totalChars: number | null;
  /** READY 일 때 앞부분만 저장됐는지. */
  truncated: boolean | null;
  /** SKIPPED/FAILED 사유 코드. */
  reasonCode: string | null;
  /** SKIPPED/FAILED 사용자 문구. */
  reason: string | null;
}

/** WP-234: 세션 첨부(GET /home/sessions/{sid}/attachments · 메시지 조회 attachments 항목). */
export interface HomeAttachment extends HomeUploadedFile {
  messageId: number;
  extraction: ExtractionInfo;
}

/** WP-234: 화면 턴 첨부 — 표시 필드 + 방금 보낸 이미지의 로컬 미리보기(blob:) URL. */
export interface TurnAttachment extends HomeUploadedFile {
  previewUrl?: string;
}

/** POST /ai/chat 응답(WP-190). sessionId 는 새 대화면 서버가 만든 id — 구 API 엔 없을 수 있어 선택. */
export interface HomeChatStarted {
  correlationId: string;
  sessionId?: string;
}

/** 서버 기준 생성 중 대화 1건(GET /ai/chat/active). */
export interface ActiveChatItem {
  sessionId: string;
  correlationId: string;
  startedAt: string; // ISO 8601
}

/** GET /ai/chat/active — 생성 중 대화 + 사용자 동시 생성 상한. */
export interface ActiveChats {
  limit: number;
  items: ActiveChatItem[];
}
