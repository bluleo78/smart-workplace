// src/components/ai/AIAssistantContext.tsx
// AI 어시스턴트의 UI 표시 모드 상태를 앱 셸 레벨에서 제공.
// 서버 세션 상태(HomeSessionContext)와 분리 — 여기서는 표시 모드/패널 폭만 다룬다.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/** AI 어시스턴트 표시 모드. closed=닫힘, side=우측 도킹, fullscreen=콘텐츠 영역 2단. */
export type AIMode = 'closed' | 'side' | 'fullscreen';

const MODE_KEY = 'ai-mode';
const WIDTH_KEY = 'ai-side-width';
// 사이드 패널 폭 범위 — 클램프는 resize() 단일 책임이므로 외부 export 불필요.
const SIDE_MIN_WIDTH = 320;
const SIDE_MAX_WIDTH = 600;
const SIDE_DEFAULT_WIDTH = 380;

interface AIAssistantValue {
  mode: AIMode;
  sidePanelWidth: number;
  /** 특정 모드로 연다. */
  open: (mode: Exclude<AIMode, 'closed'>) => void;
  /** 닫는다. */
  close: () => void;
  /** 칩 클릭 순환: closed→side→fullscreen→closed. */
  cycleMode: () => void;
  /** ⌘K 토글: 닫혀 있으면 직전 open 모드(기본 side)로, 열려 있으면 닫는다. */
  toggle: () => void;
  /** 사이드 패널 폭 변경(클램프). persist=true 일 때만 localStorage 영속(드래그 종료 시점). */
  resize: (width: number, persist?: boolean) => void;
}

// 초기 모드 — 항상 closed 로 시작(직전 모드는 toggle 복원용으로만 기억).
function readInitialWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return SIDE_DEFAULT_WIDTH;
  return Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, n));
}

const AIAssistantContext = createContext<AIAssistantValue | null>(null);

export function AIAssistantProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AIMode>('closed');
  const [sidePanelWidth, setWidth] = useState<number>(readInitialWidth);
  // ⌘K 토글 시 복원할 직전 open 모드(기본 side). localStorage(ai-mode)에 마지막 open 모드 보관.
  const lastOpen = (): Exclude<AIMode, 'closed'> => {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === 'fullscreen' ? 'fullscreen' : 'side';
  };

  const open = useCallback((m: Exclude<AIMode, 'closed'>) => {
    localStorage.setItem(MODE_KEY, m);
    setMode(m);
  }, []);
  const close = useCallback(() => setMode('closed'), []);
  const cycleMode = useCallback(() => {
    setMode((cur) => {
      const next: AIMode = cur === 'closed' ? 'side' : cur === 'side' ? 'fullscreen' : 'closed';
      if (next !== 'closed') localStorage.setItem(MODE_KEY, next);
      return next;
    });
  }, []);
  const toggle = useCallback(() => {
    setMode((cur) => (cur === 'closed' ? lastOpen() : 'closed'));
  }, []);
  // 드래그 중에는 상태만 갱신(매 pointermove 마다 localStorage 쓰기 방지), 종료 시 persist 로 1회 영속.
  const resize = useCallback((w: number, persist = false) => {
    const clamped = Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, Math.round(w)));
    if (persist) localStorage.setItem(WIDTH_KEY, String(clamped));
    setWidth(clamped);
  }, []);

  // side 모드일 때만 현재 사이드 패널 폭을 :root CSS 변수로 노출한다.
  // AIChip 은 document.body 로 portal 되므로(콘텐츠 flex 트리 밖) 패널 폭을 직접 알 수 없다.
  // → documentElement 에 변수를 심어, 칩이 패널을 침범할 때만 콘텐츠 영역 쪽으로 클램프되도록 한다(#195).
  // side 가 아니면 변수를 제거해 칩이 기본(뷰포트 중앙) 위치로 복귀하게 한다.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'side') root.style.setProperty('--ai-side-width', `${sidePanelWidth}px`);
    else root.style.removeProperty('--ai-side-width');
    return () => {
      root.style.removeProperty('--ai-side-width');
    };
  }, [mode, sidePanelWidth]);

  const value = useMemo<AIAssistantValue>(
    () => ({ mode, sidePanelWidth, open, close, cycleMode, toggle, resize }),
    [mode, sidePanelWidth, open, close, cycleMode, toggle, resize],
  );
  return <AIAssistantContext value={value}>{children}</AIAssistantContext>;
}

/** AI 어시스턴트 UI 모드 소비 훅. Provider 밖 호출 시 에러. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAssistant(): AIAssistantValue {
  const ctx = useContext(AIAssistantContext);
  if (!ctx) throw new Error('useAssistant must be used within AIAssistantProvider');
  return ctx;
}
