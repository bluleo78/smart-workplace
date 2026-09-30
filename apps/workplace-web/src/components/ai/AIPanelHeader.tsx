// src/components/ai/AIPanelHeader.tsx
// AI 어시스턴트 패널 상단 레이어 — 좌: ✦ AI 어시스턴트 타이틀 / 우: 표시 모드 전환(사이드·전체 화면) + 닫기.
// 이전엔 사이드 패널에 닫기 수단이 칩 순환·Esc 뿐이라 발견성이 낮았다(WP-111).
// 세션 스위처(대화 선택/새 대화) 행과 분리된 별도 레이어로 두어, 패널 조작과 대화 조작을 구분한다.
import { Monitor, PanelRight, Sparkles, X } from 'lucide-react';

import { type AIMode, useAssistant } from '@/components/ai/AIAssistantContext';
import { cn } from '@/lib/utils';

const iconBtn = 'rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground';

/**
 * 표시 모드 전환 + 닫기 버튼 묶음. 사이드 패널 헤더와 풀스크린 상단 바에서 공용.
 * hideClose: 모바일 탭 루트의 풀스크린 — 하단 탭바가 보이면 탭 전환이 곧 닫기라 × 를 생략한다(U2-3).
 */
export function AIPanelControls({ hideClose = false }: { hideClose?: boolean }) {
  const { mode, open, close } = useAssistant();

  // 모드 버튼 — 현재 모드는 눌린 상태(aria-pressed)로 강조하고, 다른 모드를 누르면 그 모드로 전환한다.
  const modeButton = (target: Exclude<AIMode, 'closed'>, label: string, Icon: typeof Monitor) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={mode === target}
      data-testid={`ai-mode-${target}`}
      onClick={() => open(target)}
      className={cn(iconBtn, mode === target && 'bg-muted text-foreground')}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex items-center gap-0.5">
      {/* 모바일(<lg)에선 사이드 패널도 풀스크린 오버레이라 모드 구분이 무의미 → 모드 버튼은 lg+ 에서만. */}
      <div className="flex items-center gap-0.5 max-lg:hidden">
        {modeButton('side', '사이드 패널로 보기', PanelRight)}
        {modeButton('fullscreen', '전체 화면으로 보기', Monitor)}
      </div>
      {!hideClose && (
        <button
          type="button"
          aria-label="닫기"
          title="닫기"
          data-testid="ai-panel-close"
          onClick={close}
          className={iconBtn}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** AI 어시스턴트 타이틀(✦ 아이콘 + 라벨). */
export function AIPanelTitle({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-semibold', className)}>
      <Sparkles className="h-4 w-4 text-ai-accent" />
      AI 어시스턴트
    </span>
  );
}

/** 사이드 패널 상단 헤더 — 타이틀 + 모드 전환/닫기. */
export function AIPanelHeader() {
  return (
    <div data-testid="ai-panel-header" className="flex h-12 shrink-0 items-center justify-between border-b px-3">
      <AIPanelTitle />
      <AIPanelControls />
    </div>
  );
}
