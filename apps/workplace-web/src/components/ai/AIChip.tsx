// src/components/ai/AIChip.tsx
// 상단 중앙 AI 칩(FAB) — fire-hub 치수 정합. 클릭 시 모드 순환, ⌘K 토글, Esc 닫기.
import { Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { cn } from '@/lib/utils';

/** AI 진입 칩. mode/pending 에 따라 스타일이 바뀐다. */
export function AIChip() {
  const { mode, cycleMode, toggle, close } = useAssistant();
  const { pending } = useAssistantChat();
  const open = mode !== 'closed';

  // ⌘K/Ctrl+K 토글 + Esc 닫기.
  useEffect(() => {
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
  }, [toggle, close]);

  return createPortal(
    <button
      type="button"
      data-testid="chat-launcher"
      data-mode={mode}
      aria-label="AI 어시스턴트"
      aria-expanded={open}
      onClick={cycleMode}
      className={cn(
        // 치수: 인라인 raw px 제거 → 디자인 시스템 유틸/토큰 사용(text-xs, gap-1.5, px-4/py-1.5, pill).
        'min-w-[140px] gap-1.5 rounded-full px-4 py-1.5 text-xs',
        // 데스크톱(lg+): 칩을 뷰포트 중앙(+28 AppRail 보정)에 고정하되, 사이드 패널이 칩을
        // 침범할 만큼 넓어지면(#195) 그때만 콘텐츠 영역 쪽으로 클램프한다. min() 의 두 항:
        //  1) calc(50%+28px)            — 기본 정적 중앙(패널 닫힘/좁음일 땐 항상 이 값)
        //  2) calc(100%-패널폭-70px)    — 칩 우측 끝(반폭 70px)이 패널 좌단에 닿는 최댓값
        // 패널이 좁으면 (2)>(1) 이라 정적 유지, 넓으면 (2)<(1) 이라 좌측으로 밀려 비겹침 보장.
        // --ai-side-width 미설정(closed/fullscreen/모바일)이면 (2)=100%-70px 라 항상 (1) 채택.
        // 모바일은 AppRail 보정이 불필요하므로 left-1/2 유지.
        'fixed left-1/2 top-2 z-[70] inline-flex -translate-x-1/2 items-center border font-medium shadow-md backdrop-blur transition-[left,background-color,color,border-color] duration-200 ease-in-out lg:left-[min(calc(50%+28px),calc(100%-var(--ai-side-width,0px)-70px))]',
        open
          ? 'border-ai-accent bg-card text-ai-accent'
          : 'bg-card/90 text-muted-foreground hover:text-foreground',
      )}
    >
      <Sparkles className="h-[18px] w-[18px]" />
      <span>AI 어시스턴트</span>
      {pending && <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-ai-accent" />}
    </button>,
    document.body,
  );
}
