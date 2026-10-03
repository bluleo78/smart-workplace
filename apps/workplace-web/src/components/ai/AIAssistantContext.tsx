// src/components/ai/AIAssistantContext.tsx
// AI 어시스턴트의 UI 표시 모드 상태를 앱 셸 레벨에서 제공.
// 서버 세션 상태(HomeSessionContext)와 분리 — 여기서는 표시 모드/패널 폭만 다룬다.
// 전체화면은 같은 URL 에 router state(aiOpen)를 push 해 시스템 뒤로가기(엣지 스와이프·Android back)가 AI 만 닫게 한다(WP-209).
// 쿼리를 쓰지 않는 이유: search 를 통째로 재구성하는 페이지(useFolderNavigation 'url' 모드 등)가 키를 지워 버린다.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { useChatSessionContext } from '@/hooks/chat-session-context';
import { useHistoryParam } from '@/hooks/useHistoryParam';
import { getIsMobile, useIsMobile } from '@/hooks/useIsMobile';
import { type AiActivity, aiActivity, nextUnseenDone } from '@/lib/ai/aiActivity';

/** AI 어시스턴트 표시 모드. closed=닫힘, side=우측 도킹, fullscreen=콘텐츠 영역 2단. */
export type AIMode = 'closed' | 'side' | 'fullscreen';

const MODE_KEY = 'ai-mode';
const WIDTH_KEY = 'ai-side-width';
// 전체화면 히스토리 표식 키(router state). 값은 '1'.
const HISTORY_KEY = 'aiOpen';
// 사이드 패널 폭 범위 — 클램프는 resize() 단일 책임이므로 외부 export 불필요.
const SIDE_MIN_WIDTH = 320;
const SIDE_MAX_WIDTH = 600;
const SIDE_DEFAULT_WIDTH = 380;

interface AIAssistantValue {
  mode: AIMode;
  sidePanelWidth: number;
  /** 특정 모드로 연다. */
  open: (mode: Exclude<AIMode, 'closed'>) => void;
  /** 닫는다(전체화면이면 연 히스토리 항목을 되돌린다). */
  close: () => void;
  /** 히스토리를 건드리지 않고 모드만 바꾼다 — 곧바로 다른 화면으로 이동하는 호출부(탭바·레일)용. */
  dismiss: (next?: 'closed' | 'side') => void;
  /** 현재 히스토리 항목이 AI 전체화면을 연 항목인가 — 탭바가 이동을 replace 로 할지 고른다. */
  historyOpen: boolean;
  /** 칩 클릭 순환: closed→side→fullscreen→closed. */
  cycleMode: () => void;
  /** ⌘K 토글: 닫혀 있으면 직전 open 모드(기본 side)로, 열려 있으면 닫는다. */
  toggle: () => void;
  /** 사이드 패널 폭 변경(클램프). persist=true 일 때만 localStorage 영속(드래그 종료 시점). */
  resize: (width: number, persist?: boolean) => void;
  /** 진입 버튼 표시 상태 — 표면이 열려 있으면 항상 idle(WP-191). */
  triggerActivity: AiActivity;
}

// 초기 모드 — 항상 closed 로 시작(직전 모드는 toggle 복원용으로만 기억).
function readInitialWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return SIDE_DEFAULT_WIDTH;
  return Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, n));
}

/** ⌘K 토글 시 복원할 직전 open 모드(기본 side). localStorage(ai-mode)에 마지막 open 모드 보관. */
function lastOpen(): Exclude<AIMode, 'closed'> {
  return localStorage.getItem(MODE_KEY) === 'fullscreen' ? 'fullscreen' : 'side';
}

/** 모바일(<lg)에는 사이드 패널이 없으므로 side 는 fullscreen 으로 승격해 보여준다(WP-121). */
function effectiveMode(m: AIMode, isMobile: boolean): AIMode {
  return isMobile && m === 'side' ? 'fullscreen' : m;
}
/**
 * 연 모드를 ⌘K 복원용으로 영속한다. 모바일에서 연 것(항상 풀스크린)은 저장하지 않아
 * 데스크톱 ⌘K 기본값을 건드리지 않는다. 판정은 렌더 값이 아닌 호출 시점 뷰포트 기준.
 */
function persist(m: Exclude<AIMode, 'closed'>): void {
  if (!getIsMobile()) localStorage.setItem(MODE_KEY, m);
}

const AIAssistantContext = createContext<AIAssistantValue | null>(null);

/** hotkeysEnabled — AI 가용 여부(AppLayout 이 이미 계산). false 면 ⌘K/Esc 리스너를 달지 않는다(인증 훅 결합을 피하려 prop 으로 받는다). */
export function AIAssistantProvider({ children, hotkeysEnabled }: { children: ReactNode; hotkeysEnabled: boolean }) {
  // rawMode = 사용자가 요청한 모드(side 유지). 모바일에서만 노출값(mode)이 fullscreen 으로 승격되므로
  // 데스크톱 복귀 시 side 가 복원된다. localStorage(ai-mode)는 데스크톱 ⌘K 복원용이라 데스크톱에서 연 모드만 저장하고,
  // 모바일에서 연 것(항상 풀스크린)은 저장하지 않아 데스크톱 ⌘K 기본값을 건드리지 않는다.
  const [rawMode, setMode] = useState<AIMode>('closed');
  const isMobile = useIsMobile();
  const mode = effectiveMode(rawMode, isMobile);
  // WP-191: 닫힌 사이 끝난 답변 표시. ChatSessionProvider 가 이 Provider 바깥(AppLayout)이라 pending 을 읽을 수 있다.
  // effect 대신 렌더 중 조정("prop 변화 시 state 조정" 패턴) — 완료 순간과 같은 프레임에 점이 뜬다.
  const { pending } = useChatSessionContext();
  const isOpen = mode !== 'closed';
  const [track, setTrack] = useState({ pending, unseenDone: false });
  const unseenDone = nextUnseenDone({ prevPending: track.pending, pending, open: isOpen, unseenDone: track.unseenDone });
  if (track.pending !== pending || track.unseenDone !== unseenDone) setTrack({ pending, unseenDone });
  const triggerActivity: AiActivity = isOpen ? 'idle' : aiActivity(pending, unseenDone);
  const [sidePanelWidth, setWidth] = useState<number>(readInitialWidth);

  // 전체화면 히스토리 — 들어갈 때 push, 나올 때 그 항목을 되돌린다(공용 useHistoryParam state 모드).
  const { value: historyValue, open: pushHistory, close: popHistory } = useHistoryParam(HISTORY_KEY, { mode: 'state' });
  const historyOpen = historyValue != null;

  /**
   * 모드 전이 공통 — 노출 모드 기준.
   * - 전체화면으로 들어감 + 표식 없음 → push(새로고침 뒤 남은 표식이 있으면 그 항목을 재사용).
   * - 전체화면에서 나옴 + 현재 항목에 표식 있음 → 되돌림. 표식이 없으면(AI 안 링크로 다른 화면에 PUSH 된 뒤)
   *   되돌리면 그 화면을 떠나므로 모드만 바꾼다.
   */
  const transition = useCallback(
    (next: AIMode) => {
      const nextFs = effectiveMode(next, getIsMobile()) === 'fullscreen';
      if (nextFs && !historyOpen) pushHistory('1');
      else if (!nextFs && mode === 'fullscreen' && historyOpen) popHistory();
      setMode(next);
    },
    [historyOpen, mode, pushHistory, popHistory],
  );

  // 시스템 back/forward(POP)일 때만 표식과 모드를 맞춘다 — 렌더 중 "이전 값 보관" 패턴.
  // PUSH/REPLACE(페이지의 setSearchParams 등)는 state 를 비워도 AI 를 닫지 않는다.
  const location = useLocation();
  const navType = useNavigationType();
  const [syncedKey, setSyncedKey] = useState(location.key);
  if (syncedKey !== location.key) {
    setSyncedKey(location.key);
    if (navType === 'POP') {
      if (!historyOpen && mode === 'fullscreen') setMode('closed');
      else if (historyOpen && mode !== 'fullscreen') setMode('fullscreen');
    }
  }

  const open = useCallback(
    (m: Exclude<AIMode, 'closed'>) => {
      persist(m);
      transition(m);
    },
    [transition],
  );
  const close = useCallback(() => transition('closed'), [transition]);
  const dismiss = useCallback((next: 'closed' | 'side' = 'closed') => {
    if (next !== 'closed') persist(next);
    setMode(next);
  }, []);
  // 부수효과(matchMedia·localStorage)를 setState 업데이터 밖으로 — 현재 rawMode 로 다음 모드를 계산해 1회 전이.
  const cycleMode = useCallback(() => {
    // 모바일에선 side 가 곧 fullscreen 이므로 현재 노출 모드 기준으로 순환한다.
    const eff = effectiveMode(rawMode, getIsMobile());
    const next: AIMode = eff === 'closed' ? 'side' : eff === 'side' ? 'fullscreen' : 'closed';
    if (next !== 'closed') persist(next);
    transition(next);
  }, [rawMode, transition]);
  const toggle = useCallback(() => {
    transition(rawMode === 'closed' ? lastOpen() : 'closed');
  }, [rawMode, transition]);
  // 드래그 중에는 상태만 갱신(매 pointermove 마다 localStorage 쓰기 방지), 종료 시 persist 로 1회 영속.
  const resize = useCallback((w: number, persist = false) => {
    const clamped = Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, Math.round(w)));
    if (persist) localStorage.setItem(WIDTH_KEY, String(clamped));
    setWidth(clamped);
  }, []);

  // AI 전역 단축키 — ⌘K/Ctrl+K 토글, Esc 닫기. 셸(데스크톱·모바일)과 무관하게 Provider 가 한 번만 등록한다
  // (예전엔 데스크톱 전용 AI 칩 안에 있어 lg 미만에서 사라졌다). AI 미사용 워크스페이스면 리스너를 달지 않는다.
  useEffect(() => {
    if (!hotkeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        // Radix AlertDialog/DropdownMenu 가 Esc 를 먼저 처리하면 defaultPrevented=true →
        // 그 경우 패널까지 닫지 않는다(다이얼로그만 닫힘).
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeysEnabled, toggle, close]);

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
    () => ({ mode, sidePanelWidth, open, close, dismiss, historyOpen, cycleMode, toggle, resize, triggerActivity }),
    [mode, sidePanelWidth, open, close, dismiss, historyOpen, cycleMode, toggle, resize, triggerActivity],
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
