// 모바일 AI 시트(WP-191) — 보던 화면 위로 올라오는 큰 바텀 시트. 탭바 ✦·헤더 ✦ 어디서 열든 같은 모양이다.
// Radix 모달이 아닌 이유: 모달이면 아래 탭바를 누를 수 없고, 열린 엔티티 다이얼로그와 AI 표면을 가르는 WP-54 규칙과 부딪힌다.
// MobileShell 이 본문+탭바를 덮는 셸 루트 레이어로 렌더한다. 키보드 높이는 셸(--vvh)이 이미 반영한다.
import { ChevronDown, Plus, Sparkles, Trash2 } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AIChatPanel } from '@/components/ai/AIChatPanel';
import { AIPanelControls } from '@/components/ai/AIPanelHeader';
import { markAiPanelEvent } from '@/components/ai/aiPanelSurface';
import { DeleteSessionDialog } from '@/components/ai/DeleteSessionDialog';
import { relTime } from '@/components/ai/relTime';
import { useTabBarVisible } from '@/components/mobile/useTabBarVisible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { cn } from '@/lib/utils';

// 이만큼(px) 넘게 끌어내리면 닫는다 — 그보다 짧으면 제자리로.
const CLOSE_DRAG_PX = 80;

/** mode !== 'closed' 일 때만 렌더(모바일 셸 전용). */
export function MobileAiSheet() {
  const { mode } = useAssistant();
  if (mode === 'closed') return null;
  return <SheetPanel />;
}

function SheetPanel() {
  const { close } = useAssistant();
  const chat = useAssistantChat();
  const tabBarVisible = useTabBarVisible();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  // 연 버튼(탭바 ✦·헤더 ✦)을 첫 렌더 시점에 잡아 둔다 — 이펙트 시점엔 자식 AIChatPanel 의 autoFocus 가
  // 이미 입력창으로 포커스를 옮긴 뒤라(자식 이펙트가 먼저 실행) 트리거를 잃는다.
  const [trigger] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  // 닫히면 연 버튼으로 포커스를 돌려준다(키보드·보조기기 사용자가 제자리로 돌아오도록).
  // 단, 입력 필드·body 는 제외 — WebKit(iOS)은 탭한 버튼에 포커스를 주지 않아 직전 입력창이 잡힐 수 있고,
  // 그걸 다시 포커스하면 시트를 닫을 때 키보드가 불쑥 올라온다.
  useEffect(
    () => () => {
      if (trigger?.isConnected && trigger !== document.body && !trigger.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
        trigger.focus();
      }
    },
    [trigger],
  );

  // 손잡이·헤더 빈 곳을 아래로 끌면 시트가 따라 내려오고, 임계 거리를 넘기면 닫는다. 버튼 위에서 시작한 끌기는 무시.
  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y);
    if (panelRef.current) panelRef.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.dy > CLOSE_DRAG_PX) close();
    else if (panelRef.current) panelRef.current.style.transform = '';
  };

  const current = chat.sessions.find((s) => s.id === chat.currentSessionId);

  return (
    <div
      data-testid="ai-sheet-layer"
      // WP-54: AI 표면 표식은 시트가 아닌 레이어(딤 포함)에 단다 — 열린 엔티티 다이얼로그가 페이지 영역을 inert 로 만들 때
      // (inertPageArea) 딤까지 AI 표면으로 남아 탭으로 시트를 닫을 수 있고, 딤·시트 탭이 다이얼로그의 바깥 클릭으로 취급되지 않는다.
      data-ai-panel
      onPointerDownCapture={markAiPanelEvent}
      onFocusCapture={markAiPanelEvent}
      // 키보드 닫힘: 탭바 위까지(탭바가 없으면 --mobile-tabbar-h 가 지워져 0). 키보드 열림: 탭바까지 덮는다.
      className="absolute inset-x-0 top-0 bottom-[var(--mobile-tabbar-h,0px)] z-[60] [:root[data-keyboard-open]_&]:bottom-0"
    >
      <div
        data-testid="ai-sheet-backdrop"
        aria-hidden
        onClick={close}
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-200"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="AI 비서"
        data-testid="ai-sheet"
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t-2 border-ai-accent bg-background shadow-lg animate-in slide-in-from-bottom duration-200',
          // 열림: 보던 화면 헤더(56)+한 줄(40)을 남긴다. 키보드 열림: 헤더 한 줄(56)만 남긴다.
          'top-[calc(env(safe-area-inset-top)+96px)] [:root[data-keyboard-open]_&]:top-[calc(env(safe-area-inset-top)+56px)]',
          // 탭바가 없으면 홈 인디케이터 영역을 시트가 비운다(키보드가 열리면 불필요).
          !tabBarVisible && 'pb-[env(safe-area-inset-bottom)] [:root[data-keyboard-open]_&]:pb-0',
        )}
      >
        <DeleteSessionDialog
          sessionId={pendingDeleteId}
          onConfirm={(id) => {
            chat.onDeleteSession(id);
            setPendingDeleteId(null);
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
        {/* 끌기 영역 — 손잡이 + 헤더. touch-none 으로 브라우저 스크롤 제스처 대신 포인터 이벤트를 받는다. */}
        <div
          className="shrink-0 touch-none"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div data-testid="ai-sheet-handle" className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
          <div className="flex h-12 items-center gap-1 border-b pl-4 pr-1">
            <span className="flex flex-1 items-center gap-1.5 text-sm font-semibold text-ai-accent">
              <Sparkles className="h-4 w-4" aria-hidden />
              AI
            </span>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                title={current?.title ?? '대화 목록'}
                data-testid="ai-sheet-session-switcher"
                className="flex h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground"
              >
                대화 목록
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[80] w-72">
                {chat.sessions.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">저장된 대화가 없어요</div>
                ) : (
                  chat.sessions.map((s) => (
                    <div
                      key={s.id}
                      data-testid="chat-session-item"
                      className={cn(
                        'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                        s.id === chat.currentSessionId && 'bg-ai-accent-subtle',
                      )}
                    >
                      <button
                        type="button"
                        data-testid="chat-session-select"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          chat.onSelectSession(s.id);
                          setMenuOpen(false); // 선택 후 닫기(#451)
                        }}
                      >
                        <div className="truncate">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{relTime(s.lastMessageAt)}</div>
                      </button>
                      <button
                        type="button"
                        aria-label="대화 삭제"
                        data-testid="chat-session-delete"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(s.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label="새 대화"
              data-testid="ai-sheet-new-session"
              onClick={chat.onNewSession}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-primary"
            >
              <Plus className="h-5 w-5" />
            </button>
            {/* 모바일에선 모드 버튼이 숨고(max-lg:hidden) 닫기 × 만 남는다. */}
            <AIPanelControls />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <AIChatPanel {...chat} showSessionSwitcher={false} autoFocus />
        </div>
      </div>
    </div>
  );
}
