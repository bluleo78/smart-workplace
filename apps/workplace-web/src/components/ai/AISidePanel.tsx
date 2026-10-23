// src/components/ai/AISidePanel.tsx
// 우측 도킹 사이드 패널 — 데스크톱은 flex 형제로 본문을 밀어내고(reflow), 모바일은 풀스크린 오버레이.
// 좌측 경계선 손잡이로 폭 조절(320~600, 영속) — 끌기·키보드·두 번 누르기는 앱 목록과 같은 공용 훅(WP-892).
// 상단에 타이틀·모드 전환·닫기 헤더(WP-111).
import { useRef } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AIChatPanel } from '@/components/ai/AIChatPanel';
import { AIPanelHeader } from '@/components/ai/AIPanelHeader';
import { markAiPanelEvent } from '@/components/ai/aiPanelSurface';
import { SIDE_DEFAULT_WIDTH, SIDE_MAX_WIDTH, SIDE_MIN_WIDTH } from '@/components/ai/aiSidePanelWidth';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { resizeHandleClass, useResizeHandle } from '@/hooks/useResizeHandle';

/** mode==='side' 일 때만 렌더. 데스크톱 reflow + 리사이즈, 모바일 오버레이. */
export function AISidePanel() {
  const { mode, sidePanelWidth, resize } = useAssistant();
  const chat = useAssistantChat();
  const asideRef = useRef<HTMLElement>(null);
  // 오른쪽에 붙은 패널이라 손잡이는 왼쪽 경계 — 왼쪽으로 끌수록 넓어진다.
  // 끄는 동안은 패널 폭과 --ai-side-width(AI 칩 위치)만 DOM 에 직접 쓴다 — 폭이 든 AI 컨텍스트를 매 프레임 바꾸면
  // 그 소비자(이슈 화면·레일·대화 목록)가 모두 다시 그려진다. 확정 때 한 번 상태를 바꾸고 영속한다.
  const handleProps = useResizeHandle({
    edge: 'left',
    width: sidePanelWidth,
    min: SIDE_MIN_WIDTH,
    max: SIDE_MAX_WIDTH,
    defaultWidth: SIDE_DEFAULT_WIDTH,
    onPreview: (w) => {
      if (asideRef.current) asideRef.current.style.width = `${w}px`;
      document.documentElement.style.setProperty('--ai-side-width', `${w}px`);
    },
    onCommit: (w) => resize(w, true),
    label: 'AI 패널 폭 조절',
  });

  if (mode !== 'side') return null;

  return (
    <aside
      ref={asideRef}
      data-testid="ai-side-panel"
      // WP-54: AI 표면 표식 — 엔티티 다이얼로그가 열려 있어도 이 영역 상호작용은 다이얼로그를 닫지 않는다(useAiPanelAwareDialog).
      data-ai-panel
      // WP-54: 패널 React 트리의 pointerdown/focus 를 기록 — 여기서 연 포털 레이어(Tooltip·Dropdown·AlertDialog 등)도
      // 별도 표식 없이 AI 표면으로 판별돼 열린 엔티티 다이얼로그를 닫지 않는다. 새 팝오버는 패널 트리 안에 렌더하면 충분.
      onPointerDownCapture={markAiPanelEvent}
      onFocusCapture={markAiPanelEvent}
      style={{ width: sidePanelWidth }}
      // 모바일: 인라인 width 무력화(!w-full) + 풀스크린 오버레이. 데스크톱: 정적 도킹.
      // 폭 애니메이션은 두지 않는다 — 끌기·키보드 모두 앱 목록 손잡이처럼 바로 바뀐다.
      className="relative z-[60] flex shrink-0 flex-col border-l bg-card max-lg:!fixed max-lg:inset-0 max-lg:!w-full lg:z-10"
    >
      {/* 리사이즈 핸들 — 좌측 경계. 모바일 숨김(오버레이). */}
      <div data-testid="ai-resize-handle" {...handleProps} className={`${resizeHandleClass} left-0 max-lg:hidden`} />
      {/* 패널 조작 레이어(타이틀·모드·닫기) 아래에 대화 조작 레이어(대화 선택·새 대화)가 오도록 쌓는다. */}
      <div className="flex min-h-0 flex-1 flex-col pl-1">
        <AIPanelHeader />
        <div className="min-h-0 flex-1">
          <AIChatPanel {...chat} autoFocus />
        </div>
      </div>
    </aside>
  );
}
