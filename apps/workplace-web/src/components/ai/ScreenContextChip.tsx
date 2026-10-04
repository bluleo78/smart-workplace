// src/components/ai/ScreenContextChip.tsx
// WP-54: AI 채팅 입력창 위 "화면 참고" 칩 — 지금 보고 있는 화면 정보가 다음 질문에 함께 전달됨을 보여 준다.
// 상태 2가지: 포함(ai-accent 칩 + × 로 이번 1회만 빼기) / 제외(흐린 점선 칩 + 되돌리기).
// 두 상태의 높이를 같게 맞춰 × 를 눌러도 입력 영역이 흔들리지 않는다(레이아웃 이동 방지).
// 디자인 시스템: 토큰 색만 사용(01), 배지 내부 아이콘 h-3 w-3·장식 아이콘 aria-hidden(07),
// Radix Tooltip Hover/Focus·모바일 40px 히트 영역·aria-live 알림(10).
import { Eye, EyeOff, X } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { chipLabel } from '@/lib/aiScreenContext/common';
import { HIT_AREA } from '@/lib/hitArea';
import type { AiScreenContext } from '@/types/aiScreenContext';

// 칩 공통 외형 — 두 상태가 같은 높이(py-0.5 + leading-4 + border)를 공유한다.
// max-w: 풀스크린·넓은 화면에서 한 줄 배너처럼 늘어나지 않게 36rem 상한(12 §규칙 5).
const CHIP_BASE =
  'mb-1.5 flex w-fit max-w-[min(100%,36rem)] items-center gap-1 rounded-full border py-0.5 pl-2 pr-1.5 text-xs leading-4';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

// 툴팁은 AI 사이드 패널(z-[60], 모바일 전체 오버레이) 위에 떠야 하므로 기본 z-50 보다 올린다.
const TOOLTIP_Z = 'z-[90]';

interface Props {
  /** 현재 화면 컨텍스트 — 없으면 칩을 그리지 않는다(알림 영역만 유지). */
  context: AiScreenContext | null;
  /** 이번 1회 전송에서 제외된 상태인지. */
  excluded: boolean;
  /** × — 이번 질문에서만 화면 정보를 뺀다. */
  onExclude: () => void;
  /** 되돌리기 — 제외를 취소해 다시 포함한다. */
  onRestore: () => void;
}

export function ScreenContextChip({ context, excluded, onExclude, onRestore }: Props) {
  const label = context ? chipLabel(context) : null;
  // 스크린리더 알림 문구 — 라벨/상태가 바뀔 때만 텍스트가 달라져 aria-live 가 1회 읽는다.
  const announcement = !label ? '' : excluded ? '화면 정보 빼고 보내요' : `화면 정보: ${label}`;

  return (
    <TooltipProvider>
      {/* 화면 전환·× 로 칩 내용이 바뀐 것을 SR 사용자에게 알린다(10 §F sr-only live region). */}
      <div aria-live="polite" className="sr-only" data-testid="chat-context-live">
        {announcement}
      </div>

      {label && excluded && (
        <div
          data-testid="chat-context-chip-excluded"
          className={`${CHIP_BASE} border-dashed border-border text-muted-foreground`}
        >
          <EyeOff className="h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">화면 정보 빼고 보내요</span>
          <button
            type="button"
            data-testid="chat-context-restore"
            onClick={onRestore}
            className={`${HIT_AREA} ${FOCUS_RING} shrink-0 rounded font-medium text-ai-accent hover:underline`}
          >
            되돌리기
          </button>
        </div>
      )}

      {label && !excluded && (
        <div
          data-testid="chat-context-chip"
          className={`${CHIP_BASE} border-ai-accent/30 bg-ai-accent-subtle text-ai-accent`}
        >
          <Eye className="h-3 w-3 shrink-0" aria-hidden />
          {/* 보이는 목적 문구 — 첨부/필터 칩으로 오해하지 않게. 접두어는 잘리지 않고 라벨만 잘린다. */}
          <span className="shrink-0 font-medium">화면 참고</span>
          <span aria-hidden className="text-ai-accent/50">·</span>
          <span className="sr-only">: </span>
          {/* 잘린 전체 라벨은 키보드·터치로도 볼 수 있게 포커스 가능한 Radix Tooltip 트리거로(native title 대체). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} data-testid="chat-context-label" className={`${FOCUS_RING} min-w-0 truncate rounded`}>
                {label}
                <span className="sr-only">, AI 에게 함께 전달돼요</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className={`${TOOLTIP_Z} max-w-xs break-words`}>
              {label}
            </TooltipContent>
          </Tooltip>
          {/* × — "이번 1회만" 의미를 툴팁으로 드러낸다(영구 삭제로 오해 방지). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="chat-context-remove"
                aria-label="이번 질문에만 화면 정보 빼기(보낸 뒤 다시 포함)"
                onClick={onExclude}
                className={`${HIT_AREA} ${FOCUS_RING} -my-1 -mr-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-ai-accent/10 hover:text-foreground`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className={TOOLTIP_Z}>
              이번 질문에만 빼기 · 보낸 뒤 다시 포함돼요
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </TooltipProvider>
  );
}
