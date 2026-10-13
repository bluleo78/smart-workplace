// 빈 AI 대화 추천 질문 목록(WP-139, 시안 C) — 입력 영역 맨 위, 화면 참고 칩 바로 위. 작은 머리말 + 한 줄에 하나씩 세로 목록.
// 좁은 시트(키보드가 열린 모바일)에서는 목록만 줄어 안에서 스크롤한다(포커스 링은 안쪽으로 그려 잘리지 않게).
// 행: 앞에 ai-accent 아이콘, 화살표·강조 배경 없음, hover 시 bg-muted, 모바일 44px 이상. 목록이 바뀌면 짧게 페이드인(동작 줄이기 존중).
import { Sparkles } from 'lucide-react';

import type { StarterSuggestions } from '@/hooks/useStarterSuggestions';
import { cn } from '@/lib/utils';

interface Props extends StarterSuggestions {
  /** 전송이 막힌 상태(답변 중·상한·이력 읽는 중) — 행을 비활성으로 그린다. */
  disabled: boolean;
  /** 모바일 — 행 높이 44px 이상(10-accessibility 터치 타깃). */
  isMobile: boolean;
  onPick: (query: string) => void;
}

export function StarterSuggestionList({ heading, items, holdProps, disabled, isMobile, onPick }: Props) {
  return (
    <div data-testid="starter-suggestions" role="group" aria-label={heading} className="mb-2 flex min-h-0 flex-col" {...holdProps}>
      <p className="mb-0.5 shrink-0 px-2 text-xs font-medium text-muted-foreground">{heading}</p>
      {/* key 로 목록이 바뀔 때만 다시 마운트해 페이드인 — 같은 목록에서는 깜빡이지 않는다. */}
      <ul key={items.join('\u0001')} className="min-h-0 overflow-y-auto animate-in fade-in-0 duration-150 motion-reduce:animate-none">
        {items.map((q) => (
          <li key={q}>
            <button
              type="button"
              data-testid="starter-suggestion"
              disabled={disabled}
              onClick={() => onPick(q)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
                isMobile && 'min-h-11',
              )}
            >
              <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 text-ai-accent" />
              <span className="min-w-0 truncate">{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
