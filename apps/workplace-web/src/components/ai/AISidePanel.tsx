// src/components/ai/AISidePanel.tsx
// 우측 도킹 사이드 패널 — 데스크톱은 flex 형제로 본문을 밀어내고(reflow), 모바일은 풀스크린 오버레이.
// 좌측 핸들 드래그로 폭 조절(320~600, 영속).
import { useCallback, useRef } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AIChatPanel } from '@/components/ai/AIChatPanel';
import { useAssistantChat } from '@/hooks/useAssistantChat';

/** mode==='side' 일 때만 렌더. 데스크톱 reflow + 리사이즈, 모바일 오버레이. */
export function AISidePanel() {
  const { mode, sidePanelWidth, resize } = useAssistant();
  const chat = useAssistantChat();
  const dragging = useRef(false);
  // 드래그 중 마지막 폭(raw) — 종료 시 1회 영속에 사용.
  const lastWidth = useRef(sidePanelWidth);

  // 좌측 핸들 드래그 — 패널은 우측 고정이므로 폭 = (창 우측 - 마우스X).
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (!dragging.current) return;
        lastWidth.current = window.innerWidth - ev.clientX;
        resize(lastWidth.current); // 상태만 갱신(영속 X)
      };
      const up = () => {
        dragging.current = false;
        resize(lastWidth.current, true); // 종료 시 localStorage 영속 1회
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [resize],
  );

  if (mode !== 'side') return null;

  return (
    <aside
      data-testid="ai-side-panel"
      style={{ width: sidePanelWidth }}
      // 모바일: 인라인 width 무력화(!w-full) + 풀스크린 오버레이. 데스크톱: 정적 도킹.
      className="relative z-[60] flex shrink-0 flex-col border-l bg-card transition-[width] duration-200 ease-in-out max-lg:!fixed max-lg:inset-0 max-lg:!w-full lg:z-10"
    >
      {/* 리사이즈 핸들 — 좌측 경계. 모바일 숨김. */}
      <div
        data-testid="ai-resize-handle"
        onPointerDown={onPointerDown}
        aria-hidden
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 max-lg:hidden"
      />
      <div className="min-h-0 flex-1 pl-1">
        <AIChatPanel {...chat} autoFocus />
      </div>
    </aside>
  );
}
