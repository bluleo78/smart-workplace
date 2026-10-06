// 챗 transcript 순수 변환(WP-190) — 라이브 스트림 이벤트와 복원 메시지를 ChatTurn[] 으로 바꾼다.
// 원래 useChatSession 안의 setTurns 콜백이었다. 대화별 스트림 저장소(chatStreams)가 칸마다 같은 규칙을 적용하도록 분리했다.
import { isVisibleStep, widgetTypeFromToolName } from '@/lib/aiToolLabels';
import { pushTextBlock, pushToolsBlock, pushWidgetBlock, reconcileBlocks } from '@/lib/chatBlocks';
import { toTurnAttachments } from '@/lib/homeChatAttachments';
import type {
  ActionOutcome,
  ChatTurn,
  HomeMessage,
  MessageTurn,
  PendingAction,
  ProposalCard,
  ToolEventDto,
  ToolStep,
  WidgetSpec,
  WidgetType,
} from '@/types/home';

/** 첫 토큰 전 정지 시 빈 말풍선 대신 보일 문구. */
export const STOPPED_EMPTY = '응답을 중단했어요.';
/** 첫 토큰 전 서버 시간 초과로 끝났을 때 빈 말풍선 대신 보일 문구 — 사용자가 멈춘 것이 아님을 알린다. */
export const TIMEOUT_EMPTY = '시간 초과로 중단됨';
/** 첫 토큰 전 오류 시 빈 말풍선 대신 보일 문구. */
export const FAILED_EMPTY = '응답 생성에 실패했습니다. 다시 시도해 주세요.';

/** #843: 서버 제안 → 화면 카드(대기 상태). */
export const toCards = (actions: PendingAction[]): ProposalCard[] =>
  actions.map((a) => ({ ...a, phase: 'pending' as const }));

/** #843: ACTION_* 역할 → 결과 종류. */
const OUTCOME_BY_ROLE: Partial<Record<HomeMessage['role'], ActionOutcome>> = {
  ACTION_DONE: 'done',
  ACTION_FAILED: 'failed',
  ACTION_REJECTED: 'rejected',
};

/** WP-190: 저장된 종결 상태 → 화면 표시. COMPLETE 는 표시 없음. */
const INTERRUPTED_BY_STATUS: Partial<Record<NonNullable<HomeMessage['status']>, MessageTurn['interrupted']>> = {
  STOPPED: 'stopped',
  FAILED: 'failed',
};

/**
 * 영속 메시지 → 화면 턴. 스트리밍 결과·세션 복원이 같은 규칙을 쓴다. WP-234: 첨부 복원.
 * #843: ACTION_* 는 결과 줄(role='action'). WP-158: 영속 블록 순서가 있으면 위젯 목록으로 재조정. WP-190: 중단 상태 표시.
 */
export function messageToTurn(m: HomeMessage): ChatTurn {
  // WP-234: 첨부만 보낸 USER 메시지는 content 가 비어(null) 올 수 있다 — 화면 턴은 항상 문자열로 맞춘다
  // (AIChatPanel 이 content.length·slice 를 바로 쓴다).
  const content = m.content ?? '';
  const outcome = OUTCOME_BY_ROLE[m.role];
  if (outcome) return { role: 'action', outcome, content };
  const interrupted = m.status ? INTERRUPTED_BY_STATUS[m.status] : undefined;
  return {
    role: m.role === 'ASSISTANT' ? 'assistant' : 'user',
    content,
    // WP-234: 새로고침·대화 복원 후에도 말풍선에 첨부를 다시 그린다.
    attachments: toTurnAttachments(m),
    widgets: m.widgets ?? undefined,
    steps: m.toolCalls ?? undefined,
    contentBlocks: m.contentBlocks ? reconcileBlocks(m.contentBlocks, m.widgets ?? []) : undefined,
    ...(interrupted ? { interrupted } : {}),
  };
}

/** 마지막 어시스턴트 턴만 바꾼다 — 마지막이 어시스턴트가 아니면(리셋·결과 줄 등) 원본을 그대로 돌려준다. */
function updateLastAssistant(turns: ChatTurn[], f: (t: MessageTurn) => MessageTurn): ChatTurn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'assistant') return turns;
  const next = turns.slice();
  next[next.length - 1] = f(last);
  return next;
}

/** delta — content 에 이어 붙이고(steps·widgets 보존, #449), 직전 블록이 text 가 아니면 텍스트 블록을 연다(#463). */
export const appendDelta = (turns: ChatTurn[], text: string): ChatTurn[] =>
  updateLastAssistant(turns, (last) => ({
    ...last,
    content: last.content + text,
    contentBlocks: pushTextBlock(last.contentBlocks ?? [], last.content.length),
  }));

/** progress — 위임 라벨을 delegation 단계로 추가하고 도착 위치에 도구 그룹 블록(WP-157). */
export const appendProgress = (turns: ChatTurn[], label: string): ChatTurn[] =>
  updateLastAssistant(turns, (last) => {
    const prev = last.steps ?? [];
    return {
      ...last,
      steps: [...prev, { kind: 'delegation' as const, label }],
      contentBlocks: pushToolsBlock(last.contentBlocks ?? [], prev.length),
    };
  });

/** tool — start: running 단계 추가(show_* 는 위젯 즉시 누적, #461), result: 상태 갱신(done/error). */
export function applyTool(turns: ChatTurn[], evt: ToolEventDto): ChatTurn[] {
  return updateLastAssistant(turns, (last) => {
    const steps = [...(last.steps ?? [])];
    let widgets = last.widgets;
    let contentBlocks = last.contentBlocks ?? [];
    if (evt.phase === 'start') {
      const step: ToolStep = { kind: 'tool', seq: evt.seq, toolName: evt.toolName, args: evt.args, status: 'running' };
      // WP-157: 표시되는 단계만 그룹 블록을 연다 — 숨김 도구가 빈 풍선을 만들거나 텍스트를 끊지 않게.
      if (isVisibleStep(step)) contentBlocks = pushToolsBlock(contentBlocks, steps.length);
      steps.push(step);
      const wtype = evt.toolName ? widgetTypeFromToolName(evt.toolName) : null;
      if (wtype) {
        const w: WidgetSpec = { type: wtype as WidgetType, params: (evt.args?.params as Record<string, unknown>) ?? {} };
        const layout = evt.args?.layout as WidgetSpec['layout'] | undefined;
        if (layout) w.layout = layout;
        widgets = [...(last.widgets ?? []), w];
        contentBlocks = pushWidgetBlock(contentBlocks, w);
      }
    } else {
      const idx = steps.findIndex((s) => s.kind === 'tool' && s.seq === evt.seq && s.status === 'running');
      if (idx !== -1) steps[idx] = { ...steps[idx], status: evt.isError ? 'error' : 'done' };
    }
    return { ...last, steps, widgets, contentBlocks };
  });
}

/**
 * done — 서버 위젯 목록이 있으면 authoritative 로 갈아끼우고 위젯 블록을 재조정(#463 I1).
 * 비어 있으면 라이브 tool 이벤트로 누적한 위젯을 보존한다(#461).
 */
export function applyDoneWidgets(turns: ChatTurn[], widgets?: WidgetSpec[] | null): ChatTurn[] {
  if (!widgets || widgets.length === 0) return turns;
  return updateLastAssistant(turns, (last) => ({
    ...last,
    widgets,
    contentBlocks: last.contentBlocks ? reconcileBlocks(last.contentBlocks, widgets) : last.contentBlocks,
  }));
}

/** 종결 종류별 첫 토큰 전 안내 문구. */
const EMPTY_BY_KIND: Record<NonNullable<MessageTurn['interrupted']>, string> = {
  stopped: STOPPED_EMPTY,
  failed: FAILED_EMPTY,
  timeout: TIMEOUT_EMPTY,
};

/** WP-190: 정지·오류·시간 초과 종결 — 본문이 있으면 "중단됨" 류 표시, 첫 토큰 전이면 빈 말풍선 대신 안내 문구(문구가 이미 상태를 말하므로 라벨 없음). */
export function markInterrupted(turns: ChatTurn[], kind: NonNullable<MessageTurn['interrupted']>): ChatTurn[] {
  return updateLastAssistant(turns, (last) => {
    const empty = last.content === '' && !last.widgets?.length && !last.contentBlocks?.length;
    if (empty) return { role: 'assistant', content: EMPTY_BY_KIND[kind] };
    return { ...last, interrupted: kind };
  });
}
