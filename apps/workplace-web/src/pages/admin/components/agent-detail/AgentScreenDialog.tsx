// AI 작업 화면 보기(WP-1277) — 관리자가 Works 가 띄운 AI 의 tmux 화면을 브라우저 터미널(xterm.js)로 본다. 거의 전체 화면 창(시안 A).
// 기본은 보기 전용, 「입력 허용」은 확인 창 뒤 키가 그대로 AI 터미널로 간다(입력은 서버가 감사 기록). 연결: 세션 열기(POST) → ticket 으로 WebSocket.
import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { agentScreenSocketUrl, createAgentScreenSession } from '@/api/agentRuntime';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  activeScreenWindow,
  type AgentScreenFrame,
  type AgentScreenState,
  INITIAL_SCREEN_STATE,
  parseScreenFrame,
  reduceScreen,
  screenSocketClosed,
  screenWindowLabel,
} from '@/lib/agentScreen';
import { extractApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

/** 소켓 열기 — 테스트·시제품에서 가짜로 바꿔 끼운다. */
export type OpenScreenSocket = (url: string) => WebSocket;

/** 기본 소켓 열기 — 모듈 한 곳에 두어야 렌더마다 새 함수가 되지 않는다(연결 effect 의 의존성이라 바뀌면 다시 연결한다). */
const openBrowserSocket: OpenScreenSocket = (url) => new WebSocket(url);

type Action = { kind: 'frame'; frame: AgentScreenFrame } | { kind: 'closed' } | { kind: 'reset' } | { kind: 'failed'; reason: string };

function reducer(state: AgentScreenState, a: Action): AgentScreenState {
  if (a.kind === 'frame') return reduceScreen(state, a.frame);
  if (a.kind === 'closed') return screenSocketClosed(state);
  if (a.kind === 'failed') return { ...INITIAL_SCREEN_STATE, phase: 'ended', reason: a.reason };
  return INITIAL_SCREEN_STATE;
}

const PHASE_LABEL: Record<AgentScreenState['phase'], string> = { connecting: '연결 중', attached: '연결됨', ended: '끊김' };

export function AgentScreenDialog({
  agentUserId,
  agentName,
  open,
  onOpenChange,
  openSocket = openBrowserSocket,
}: {
  agentUserId: number;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openSocket?: OpenScreenSocket;
}) {
  const isMobile = useIsMobile();
  const [state, dispatch] = useReducer(reducer, INITIAL_SCREEN_STATE);
  const [confirmInput, setConfirmInput] = useState(false);
  // 다시 연결할 때마다 올려 소켓·터미널을 새로 만든다.
  const [attempt, setAttempt] = useState(0);
  // 터미널 자리 — Radix Dialog 는 포털 안 내용을 다음 렌더에 그리므로 ref 가 아니라 상태로 받아, 자리가 생긴 뒤에 연결한다.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const send = useCallback((o: unknown) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
  }, []);

  // 연결 — 열려 있는 동안 한 번(다시 연결이면 새로). 닫히면 소켓·터미널을 정리한다.
  useEffect(() => {
    if (!open || !host) return;
    let disposed = false;
    dispatch({ kind: 'reset' });
    const term = new Terminal({ fontSize: 13, convertEol: false, cursorBlink: false, disableStdin: false, scrollback: 0 });
    termRef.current = term;
    term.open(host);
    // 키 입력은 바이트로 보낸다 — 보기 전용이어도 보내지만 서버가 버린다(서버 판정이 기준).
    const keys = term.onData((d) => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(d));
    });
    createAgentScreenSession(agentUserId)
      .then((s) => {
        if (disposed) return;
        const ws = openSocket(agentScreenSocketUrl(s.ticket));
        ws.binaryType = 'arraybuffer';
        socketRef.current = ws;
        ws.onmessage = (e: MessageEvent) => {
          if (typeof e.data === 'string') {
            const frame = parseScreenFrame(e.data);
            if (frame) dispatch({ kind: 'frame', frame });
          } else {
            term.write(new Uint8Array(e.data as ArrayBuffer));
          }
        };
        ws.onclose = () => !disposed && dispatch({ kind: 'closed' });
      })
      .catch((e: unknown) => !disposed && dispatch({ kind: 'failed', reason: extractApiError(e, '작업 화면을 열지 못했어요') }));
    return () => {
      disposed = true;
      keys.dispose();
      socketRef.current?.close();
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [open, host, attempt, agentUserId, openSocket]);

  // 창 크기에 터미널을 맞추고 tmux 클라이언트 크기로 알린다 — 보는 동안 AI 창이 이 크기를 따른다(13px 글자로 읽히게).
  const current = activeScreenWindow(state.windows);
  useEffect(() => {
    const term = termRef.current;
    if (!term || !host) return;
    const fit = new FitAddon();
    term.loadAddon(fit);
    const apply = () => {
      fit.fit();
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(host);
    return () => {
      ro.disconnect();
      fit.dispose();
    };
  }, [host, attempt, state.phase, send]);

  const inputOn = state.input && state.phase === 'attached';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[92vh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1600px)]"
        showCloseButton={false}
        data-testid="agent-screen-dialog"
        // 터미널이 키(Esc 포함)를 받아야 한다 — 입력 중에는 Esc 로 창이 닫히지 않게.
        onEscapeKeyDown={(e) => inputOn && e.preventDefault()}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
          <DialogTitle className="text-sm font-semibold">작업 화면 · {agentName}</DialogTitle>
          <DialogDescription className="sr-only">AI 의 작업 칸과 알림 칸을 실시간으로 봅니다.</DialogDescription>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="agent-screen-phase">
            <span
              className={cn(
                'size-2 rounded-full',
                state.phase === 'attached' ? 'bg-success' : state.phase === 'connecting' ? 'bg-warning' : 'bg-muted-foreground',
              )}
              aria-hidden
            />
            {PHASE_LABEL[state.phase]}
          </span>
          {state.phase === 'attached' && (
            <span className={cn('text-xs', inputOn ? 'font-medium text-warning-text' : 'text-muted-foreground')} data-testid="agent-screen-mode">
              {inputOn ? '입력 중' : '보기 전용'}
            </span>
          )}
          {state.windows.length > 1 && (
            <div className="flex items-center gap-1" role="tablist" aria-label="창">
              {state.windows.map((w) => (
                <Button
                  key={w.index}
                  size="xs"
                  variant={w.index === current?.index ? 'secondary' : 'ghost'}
                  role="tab"
                  aria-selected={w.index === current?.index}
                  onClick={() => send({ type: 'window', index: w.index })}
                >
                  {screenWindowLabel(w.name)}
                </Button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!isMobile && state.phase === 'attached' && state.inputAllowed && !inputOn && (
              <Button size="sm" variant="outline" onClick={() => setConfirmInput(true)} data-testid="agent-screen-input-on">
                입력 허용
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          </div>
        </div>

        {inputOn && (
          <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning-subtle px-4 py-2 text-xs text-foreground" data-testid="agent-screen-input-band">
            <AlertTriangle className="size-3.5 shrink-0 text-warning-text" aria-hidden />
            <span className="flex-1">입력 중 — 치는 키가 AI 화면에 그대로 갑니다. 입력은 기록됩니다.</span>
            <Button size="xs" variant="outline" onClick={() => send({ type: 'input', enabled: false })}>
              보기 전용으로
            </Button>
          </div>
        )}
        {state.notice && (
          <p className="border-b px-4 py-2 text-xs text-destructive" role="alert">
            {state.notice}
          </p>
        )}

        <div className={cn('relative min-h-0 flex-1 overflow-auto bg-black p-2', inputOn && 'ring-2 ring-inset ring-warning')}>
          <div ref={setHost} className="h-full" data-testid="agent-screen-terminal" />
          {state.phase === 'ended' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 text-sm" data-testid="agent-screen-ended">
              <p>연결이 끊겼습니다 — {state.reason}</p>
              <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw aria-hidden />
                다시 연결
              </Button>
            </div>
          )}
        </div>

        <AlertDialog open={confirmInput} onOpenChange={setConfirmInput}>
          <AlertDialogContent size="sm" data-testid="agent-screen-input-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>입력을 허용할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                치는 키가 AI 의 작업 화면에 그대로 갑니다. 이 AI 작업 공간에서 명령을 직접 실행하는 것과 같아 AI 가 하던 일이 바뀌거나 AI 의 비밀값에 닿을 수 있습니다. 입력한 내용은 감사 기록에 남습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  send({ type: 'input', enabled: true });
                  termRef.current?.focus();
                }}
              >
                입력 허용
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
