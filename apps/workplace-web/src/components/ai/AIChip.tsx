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
      // fire-hub 치수는 인라인 style 로 고정(Tailwind 임의값 대신 정확 정합).
      style={{
        minWidth: 140,
        padding: '6px 16px',
        fontSize: 12,
        borderRadius: 20,
        gap: 6,
      }}
      className={cn(
        // 데스크톱(lg+): 칩을 "콘텐츠 영역"(뷰포트−사이드패널폭) 중앙에 정렬한다.
        // side 모드에서 --ai-side-width 가 설정되면 칩이 패널과 안 겹치도록 좌측으로 이동.
        // 변수 미설정(closed/fullscreen, 또는 모바일)이면 0px → 기존처럼 뷰포트 중앙(+28 AppRail 보정).
        // 모바일은 패널이 풀스크린 오버레이라 콘텐츠-중앙 계산이 부적합하므로 left-1/2 유지.
        'fixed left-1/2 top-2 z-[70] inline-flex -translate-x-1/2 items-center border font-medium shadow-md backdrop-blur transition-[left,background-color,color,border-color] duration-200 ease-in-out lg:left-[calc((100%-var(--ai-side-width,0px))/2+28px)]',
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
