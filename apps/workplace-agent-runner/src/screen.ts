// 작업 화면 보기(WP-1277) — Works 가 SSE 로 「화면 열기」(agent-runtime.screen)를 알리면 runner 가 Works 쪽으로 화면 전용 WebSocket 을 열고,
// AI Pod 에 exec 로 이미지의 agent-screen 을 붙여 바이트를 잇는다. 실행 환경으로 들어오는 포트를 열지 않는다(runner 가 바깥으로만 연다).
// 프레임: 바이너리 = 터미널 바이트(Pod→Works 는 출력, Works→Pod 는 입력), 텍스트 = JSON 제어(계약 문서 agent-runner-api.md 「작업 화면」).
// 보기 전용은 agent-screen 이 tmux read-only 로 붙고, 이쪽도 입력 바이트를 버린다(Works 가 막는 것과 함께 세 겹).
import { Writable, PassThrough, type Readable } from 'node:stream';
import type { Logger } from './works/events.js';

/** SSE agent-runtime.screen 의 data. */
export interface ScreenRequest {
  sessionId: string;
  agentUserId: number;
}

/** Works 쪽 화면 소켓 — ws 를 감싸 테스트에서 바꿔 끼운다. */
export interface ScreenSocket {
  send(data: Buffer | string): void;
  close(code: number, reason: string): void;
  onMessage(cb: (data: Buffer, isBinary: boolean) => void): void;
  onClose(cb: () => void): void;
}

/** Pod exec 한 번 — 끝나면 onExit(정상 0, 아니면 이유 한 줄). close 는 exec 를 끊는다(agent-screen 이 HUP 을 받아 보기 세션을 지운다). */
export interface ExecHandle {
  close(): void;
}
export interface PodExec {
  run(opts: {
    pod: string;
    command: string[];
    stdin: Readable | null;
    stdout: Writable;
    tty: boolean;
    onExit: (error: string | null) => void;
  }): Promise<ExecHandle>;
}

export interface ScreenDeps {
  /** Works 화면 소켓 열기 — 실패하면 던진다. */
  connect(sessionId: string): Promise<ScreenSocket>;
  exec: PodExec;
  /** 그 AI 의 Pod 가 내 위치에서 떠 있으면 Pod 이름, 아니면 null. */
  findAgentPod(agentUserId: number): Promise<string | null>;
  log: Logger;
  /** 이 실행 환경이 작업 화면 입력을 허용하는지(차트 screen.allowInput) — 아니면 입력 요청을 거절하고 늘 read-only 로 붙는다. */
  allowInput: boolean;
  /** 창 목록을 다시 보내는 주기(ms) — 창이 생기고 없어지는 것을 따라간다. */
  windowsIntervalMs?: number;
}

/** 이미지의 agent-screen 경로(계약 문서 「작업 화면」). */
export const AGENT_SCREEN = '/opt/genia/bin/agent-screen';
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;
/** 한 runner 가 동시에 이어 주는 화면 수 — 관리자 실수·버그로 exec 가 쌓이지 않게. */
export const MAX_SCREENS = 10;
const WINDOWS_INTERVAL_MS = 15_000;

/** 창 한 개 — agent-screen windows 의 한 줄. */
export interface ScreenWindow {
  index: number;
  name: string;
  width: number;
  height: number;
  active: boolean;
}

/** agent-screen windows 출력(번호·이름·폭·높이·보는 창, 탭 구분)을 읽는다. 모양이 틀린 줄은 버린다. */
export function parseWindows(out: string): ScreenWindow[] {
  return out
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length === 5 && /^\d+$/.test(c[0]) && /^\d+$/.test(c[2]) && /^\d+$/.test(c[3]))
    .map(([i, name, w, h, a]) => ({ index: Number(i), name, width: Number(w), height: Number(h), active: a === '1' }));
}

/** exec 오류를 관리자에게 보일 한 줄로 — 옛 차트(pods/exec 권한 없음)는 고칠 방법까지. */
export function execFailureReason(message: string): string {
  if (/\b403\b|forbidden/i.test(message)) return '실행 환경 runner 에 작업 화면 권한(pods/exec)이 없어요 — runner 차트를 업그레이드하세요';
  if (/exit code 3|작업 화면이 아직 없습니다/.test(message)) return 'AI 의 작업 화면이 아직 준비되지 않았어요';
  return '작업 화면 연결이 끊겼어요';
}

/** 열린 화면 수 — MAX_SCREENS 를 넘으면 새 요청을 받지 않는다. */
let openScreens = 0;
export function openScreenCount(): number {
  return openScreens;
}

/**
 * 화면 하나를 잇는다. Works 소켓이 닫히거나 exec 가 끝나면 둘 다 닫는다. 던지지 않는다(실패는 소켓 status 로 알리고 로그에 남긴다).
 */
export async function openScreen(deps: ScreenDeps, req: ScreenRequest): Promise<void> {
  if (!SESSION_ID.test(req.sessionId) || !Number.isInteger(req.agentUserId)) {
    deps.log.warn('작업 화면 요청 모양이 틀려 무시합니다');
    return;
  }
  if (openScreens >= MAX_SCREENS) {
    deps.log.warn('작업 화면이 너무 많이 열려 있어 새 요청을 받지 않습니다', { max: MAX_SCREENS });
    return;
  }
  openScreens++;
  let socket: ScreenSocket;
  try {
    socket = await deps.connect(req.sessionId);
  } catch (e) {
    openScreens--;
    deps.log.warn('작업 화면 소켓을 열지 못했습니다', { sessionId: req.sessionId, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  const status = (state: 'attached' | 'ended', reason?: string) =>
    socket.send(JSON.stringify({ type: 'status', state, ...(reason ? { reason } : {}) }));

  // 지금 붙은 exec 와 그 상태 — 입력 허용을 바꾸면 끊고 다시 붙는다(tmux read-only 는 붙을 때 정해진다).
  let handle: ExecHandle | null = null;
  let input = false;
  let window: number | null = null;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // 붙을 때마다 올린다 — 입력 허용을 바꾸려고 끊은 옛 exec 의 onExit(늦게 올 수 있다)가 새 화면을 닫지 않게,
  // 늦게 끝난 옛 attach 가 붙인 exec 를 바로 닫게. 보기 세션 이름(gw-view-<세션>-<회차>)에도 쓴다 — 옛 exec 의 정리(보기 세션 지우기)가
  // 새로 붙은 보기 세션을 지우지 않게 회차마다 다른 세션에 붙는다.
  let generation = 0;
  let view = `${req.sessionId}-0`;
  let stdin = new PassThrough();
  // tty 크기 — exec 가 rows·columns 가 있는 stdout 을 보고 'resize' 로 크기를 보낸다(client-node TerminalSizeQueue).
  // exec 마다 새 stdout 을 만든다 — Exec 가 stdout 에 단 'resize' 듣기가 옛 exec 에 남아 쌓이지 않게.
  const size = { rows: 30, columns: 100 };
  let term = newTerm();
  function newTerm() {
    return Object.assign(
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          if (!closed) socket.send(chunk);
          cb();
        },
      }),
      { ...size },
    );
  }

  const finish = (reason?: string) => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    handle?.close();
    stdin.end();
    if (reason) status('ended', reason);
    socket.close(1000, 'ended');
    openScreens--;
  };
  // Pod 를 찾는 동안 Works 가 닫아도 놓치지 않게 바로 단다.
  socket.onClose(() => finish());

  const pod = await deps.findAgentPod(req.agentUserId).catch(() => null);
  if (closed) return;
  if (!pod) {
    finish('AI 작업 공간이 떠 있지 않아요');
    return;
  }

  // 창 목록 — 조회가 겹치지 않게 하나씩 돌리고(느린 Pod 에 exec 가 쌓이지 않게), 바뀐 때만 보낸다(창 고르기·다시 붙기 뒤에는 꼭 보낸다).
  let windowsBusy = false;
  let windowsAgain = false;
  let lastWindows = '';
  const sendWindows = async (force = false): Promise<void> => {
    if (windowsBusy) {
      // 도는 중에 창 고르기 등으로 꼭 보내야 하면 끝난 뒤 한 번 더 돈다.
      windowsAgain ||= force;
      return;
    }
    windowsBusy = true;
    let out = '';
    const sink = new Writable({
      write(chunk: Buffer, _e, cb) {
        out += chunk.toString('utf8');
        cb();
      },
    });
    await new Promise<void>((resolve) => {
      deps.exec
        .run({ pod, command: [AGENT_SCREEN, 'windows', view], stdin: null, stdout: sink, tty: false, onExit: () => resolve() })
        .catch(() => resolve());
    });
    windowsBusy = false;
    const frame = JSON.stringify({ type: 'windows', items: parseWindows(out) });
    if (!closed && (force || frame !== lastWindows)) {
      lastWindows = frame;
      socket.send(frame);
    }
    if (windowsAgain && !closed) {
      windowsAgain = false;
      return sendWindows(true);
    }
  };

  const attach = async () => {
    const mine = ++generation;
    view = `${req.sessionId}-${mine}`;
    const command = [AGENT_SCREEN, 'attach', view, ...(input ? ['--input'] : []), ...(window != null ? ['--window', String(window)] : [])];
    stdin.end();
    stdin = new PassThrough();
    term = newTerm();
    const h = await deps.exec.run({
      pod,
      command,
      stdin,
      stdout: term,
      tty: true,
      onExit: (error) => {
        if (mine !== generation || closed) return;
        finish(error ? execFailureReason(error) : '작업 화면이 닫혔어요');
      },
    });
    // 기다리는 동안 다시 붙기·닫기가 왔으면 이 exec 는 버린다(남기면 tmux 클라이언트가 하나 더 붙은 채 출력을 겹쳐 쓴다).
    if (mine !== generation || closed) {
      h.close();
      return;
    }
    handle = h;
    status('attached');
    // allowed — 화면이 「입력 허용」 단추를 보일지 정한다(실행 환경이 허용하지 않으면 숨긴다).
    socket.send(JSON.stringify({ type: 'input', enabled: input, allowed: deps.allowInput }));
    void sendWindows(true);
  };

  timer = setInterval(() => void sendWindows(), deps.windowsIntervalMs ?? WINDOWS_INTERVAL_MS);
  socket.onMessage((data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      // 보기 전용이면 버린다 — Works 가 이미 막지만 한 번 더.
      if (input) stdin.write(data);
      return;
    }
    let msg: { type?: string; cols?: number; rows?: number; index?: number; enabled?: boolean };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
      size.columns = Math.min(Math.max(msg.cols as number, 10), 500);
      size.rows = Math.min(Math.max(msg.rows as number, 5), 200);
      Object.assign(term, size);
      term.emit('resize');
    } else if (msg.type === 'window' && Number.isInteger(msg.index) && (msg.index as number) >= 0) {
      window = msg.index as number;
      void deps.exec
        .run({
          pod,
          command: [AGENT_SCREEN, 'select', view, String(window)],
          stdin: null,
          stdout: new Writable({ write: (_c, _e, cb) => cb() }),
          tty: false,
          onExit: () => void sendWindows(true),
        })
        .catch(() => undefined);
    } else if (msg.type === 'input' && typeof msg.enabled === 'boolean' && msg.enabled !== input) {
      if (msg.enabled && !deps.allowInput) {
        socket.send(JSON.stringify({ type: 'error', message: '이 실행 환경은 작업 화면 입력을 허용하지 않아요' }));
        return;
      }
      input = msg.enabled;
      handle?.close();
      handle = null;
      attach().catch((e: unknown) => finish(execFailureReason(e instanceof Error ? e.message : String(e))));
    }
  });

  try {
    await attach();
    deps.log.info('작업 화면을 이었습니다', { sessionId: req.sessionId, agentUserId: req.agentUserId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.log.warn('작업 화면 exec 실패', { sessionId: req.sessionId, error: message.split('\n')[0].slice(0, 200) });
    finish(execFailureReason(message));
  }
}
