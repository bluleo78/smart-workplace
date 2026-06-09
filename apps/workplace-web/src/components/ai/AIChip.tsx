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
        'fixed left-1/2 top-2 z-[70] inline-flex -translate-x-1/2 items-center border font-medium shadow-md backdrop-blur transition-colors lg:left-[calc(50%+28px)]',
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
