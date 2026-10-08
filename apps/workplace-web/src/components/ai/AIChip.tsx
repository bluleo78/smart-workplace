// src/components/ai/AIChip.tsx
// 상단 중앙 AI 칩(FAB) — fire-hub 치수 정합. 클릭 시 모드 순환. ⌘K·Esc 는 AIAssistantProvider 가 전역 처리.
import { createPortal } from 'react-dom';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AiSparkle } from '@/components/ai/AiSparkle';
import { aiTriggerLabel } from '@/lib/ai/aiActivity';
import { cn } from '@/lib/utils';

/** AI 진입 칩. mode/triggerActivity 에 따라 스타일이 바뀐다. */
export function AIChip() {
  const { mode, cycleMode, triggerActivity } = useAssistant();
  const open = mode !== 'closed';

  return createPortal(
    <button
      type="button"
      data-testid="chat-launcher"
      // WP-54: AI 표면 표식 — non-modal 다이얼로그가 열린 채 칩을 눌러도 다이얼로그가 닫히지 않게(useAiPanelAwareDialog).
      data-ai-panel
      // 페이지 헤더 좌측 그룹이 이 칩의 실제 위치를 재서 겹치지 않게 자른다(useAiChipClamp).
      data-ai-chip
      data-mode={mode}
      data-ai-activity={triggerActivity}
      aria-label={aiTriggerLabel('AI 어시스턴트', triggerActivity)}
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
        // WP-191: 닫힌 동안 생성 중이면 칩 테두리 빛 회전 + 보라 글자. 패널이 열려 있으면 triggerActivity=idle(패널 안 3-dot 이 담당).
        triggerActivity === 'pending' && 'ai-ring text-ai-accent',
      )}
    >
      <AiSparkle activity={triggerActivity} className="h-[18px] w-[18px]" dotClassName="right-2 top-1 ring-card" />
      <span>AI 어시스턴트</span>
    </button>,
    document.body,
  );
}
