// 작업 화면 보기(WP-1277) — Works 의 작업 화면 WebSocket 제어 프레임 읽기·상태 전이·창 이름·글자 크기 같은 순수 판정.
// 바이너리 프레임은 터미널 바이트라 여기서 다루지 않는다(xterm 이 그대로 그린다).

/** AI tmux 창 한 개 — runner 가 agent-screen windows 로 읽어 보낸다. */
export interface AgentScreenWindow {
  index: number;
  name: string;
  width: number;
  height: number;
  active: boolean;
}

/** 화면 연결 상태 — connecting: 세션·소켓을 여는 중, attached: AI 화면에 붙음, ended: 끝남(reason 이 이유). */
export interface AgentScreenState {
  phase: 'connecting' | 'attached' | 'ended';
  /** 입력 허용 — runner 가 실제로 다시 붙은 뒤의 값(서버가 확인한 것만). */
  input: boolean;
  /** 이 실행 환경이 입력을 허용하는지(runner 차트 screen.allowInput) — 아니면 「입력 허용」 단추를 숨긴다. */
  inputAllowed: boolean;
  windows: AgentScreenWindow[];
  reason: string | null;
  /** 잠깐 보이는 오류(예: 다른 관리자가 입력 중) — 연결은 유지. */
  notice: string | null;
}

export const INITIAL_SCREEN_STATE: AgentScreenState = { phase: 'connecting', input: false, inputAllowed: false, windows: [], reason: null, notice: null };

/** 서버가 보내는 텍스트 프레임. 모르는 type 은 null. */
export type AgentScreenFrame =
  | { type: 'status'; state: 'attached' | 'ended'; reason?: string }
  | { type: 'windows'; items: AgentScreenWindow[] }
  | { type: 'input'; enabled: boolean; allowed: boolean }
  | { type: 'error'; message: string };

/** 작업 화면을 열 수 있는 상태 — 작업 공간이 떠 있을 때(실행 중·쉴 때 적용 대기)만. 서버도 같은 기준으로 409 를 낸다. */
export function canViewScreen(status: string): boolean {
  return status === 'RUNNING' || status === 'APPLY_PENDING';
}

/** 텍스트 프레임 한 개를 읽는다 — 모양이 틀리면 null(무시). */
export function parseScreenFrame(text: string): AgentScreenFrame | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const f = o as Record<string, unknown>;
  if (f.type === 'status' && (f.state === 'attached' || f.state === 'ended')) {
    return { type: 'status', state: f.state, ...(typeof f.reason === 'string' ? { reason: f.reason } : {}) };
  }
  if (f.type === 'windows' && Array.isArray(f.items)) {
    const items = f.items.filter(
      (w): w is AgentScreenWindow =>
        !!w && Number.isInteger(w.index) && typeof w.name === 'string' && Number.isInteger(w.width) && Number.isInteger(w.height) && typeof w.active === 'boolean',
    );
    return { type: 'windows', items };
  }
  // allowed 가 없으면(옛 runner) 허용하지 않은 것으로 본다
  if (f.type === 'input' && typeof f.enabled === 'boolean') return { type: 'input', enabled: f.enabled, allowed: f.allowed === true };
  if (f.type === 'error' && typeof f.message === 'string') return { type: 'error', message: f.message };
  return null;
}

/** 프레임 → 다음 상태. 끝난 뒤에 온 프레임은 무시한다. */
export function reduceScreen(state: AgentScreenState, frame: AgentScreenFrame): AgentScreenState {
  if (state.phase === 'ended') return state;
  switch (frame.type) {
    case 'status':
      return frame.state === 'attached'
        ? { ...state, phase: 'attached', reason: null }
        : { ...state, phase: 'ended', input: false, reason: frame.reason ?? '작업 화면 연결이 끊겼어요' };
    case 'windows':
      return { ...state, windows: frame.items };
    case 'input':
      return { ...state, input: frame.enabled, inputAllowed: frame.allowed, notice: null };
    case 'error':
      return { ...state, notice: frame.message };
  }
}

/** 소켓이 서버 프레임 없이 닫혔을 때 — 이미 끝났으면 그 이유를 둔다. */
export function screenSocketClosed(state: AgentScreenState): AgentScreenState {
  return state.phase === 'ended' ? state : { ...state, phase: 'ended', input: false, reason: '작업 화면 연결이 끊겼어요' };
}

/** 창 탭 이름 — 알림 감시 창(events)은 「알림」, 그 밖은 tmux 창 이름(프로젝트 키) 그대로. */
export function screenWindowLabel(name: string): string {
  return name === 'events' ? '알림' : name;
}

/** 지금 보는 창 — active 가 없으면 첫 창. */
export function activeScreenWindow(windows: AgentScreenWindow[]): AgentScreenWindow | null {
  return windows.find((w) => w.active) ?? windows[0] ?? null;
}
