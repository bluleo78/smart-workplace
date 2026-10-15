// AI 대화 추천 질문 목록(WP-139 → WP-398) — 빈 대화 추천과 답 뒤 후속 질문이 같은 모양으로 쓴다.
// 둘 다 대화 영역 안에 놓인다: 빈 대화는 가운데 안내 바로 아래, 후속 질문은 마지막 답 바로 아래.
// 작은 머리말 + 한 줄에 하나씩 세로 목록. 행: 앞에 ai-accent 아이콘, 화살표·강조 배경 없음, hover 시 bg-muted, 모바일 44px 이상.
// 긴 문구(최대 40자)는 두 줄까지 감는다. 목록이 바뀌면 짧게 페이드인(동작 줄이기 존중).
import { Sparkles } from 'lucide-react';
import { useId } from 'react';

import type { StarterSuggestions } from '@/hooks/useStarterSuggestions';
import { cn } from '@/lib/utils';

interface Props {
  /** 목록 위 작은 머리말 — 그룹의 접근 이름도 된다. */
  heading: string;
  items: string[];
  /** 전송이 막힌 상태(답변 중·동시 답변 상한·다른 창 답변 중) — 행을 비활성으로 그린다. */
  disabled: boolean;
  /** 모바일 — 행 높이 44px 이상(10-accessibility 터치 타깃). */
  isMobile: boolean;
  onPick: (query: string) => void;
  testId: string;
  itemTestId: string;
  /** 목록 컨테이너에 펼치는 교체 보류 이벤트 — 빈 대화 추천만 쓴다(후속 질문은 한 번 오고 바뀌지 않는다). */
  holdProps?: StarterSuggestions['holdProps'];
  className?: string;
}

export function SuggestionList({ heading, items, disabled, isMobile, onPick, testId, itemTestId, holdProps, className }: Props) {
  const headingId = useId();
  return (
    <div data-testid={testId} role="group" aria-labelledby={headingId} className={cn('flex flex-col', className)} {...holdProps}>
      <p id={headingId} className="mb-0.5 px-2 text-xs font-medium text-muted-foreground">{heading}</p>
      {/* key 로 목록이 바뀔 때만 다시 마운트해 페이드인 — 같은 목록에서는 깜빡이지 않는다. */}
      <ul key={items.join('\u0001')} className="animate-in fade-in-0 duration-150 motion-reduce:animate-none">
        {items.map((q, i) => (
          // 문구 중복 제거는 ai-agent 가 한다 — 혹시 겹쳐도 key 가 충돌하지 않게 위치를 붙인다.
          <li key={`${i}-${q}`}>
            <button
              type="button"
              data-testid={itemTestId}
              disabled={disabled}
              onClick={() => onPick(q)}
              // 두 줄로 감길 수 있어 아이콘은 첫 줄에 맞춘다(items-start + 첫 줄 가운데 mt). 모바일 py-3 — 한 줄이면 정확히 44px.
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
                isMobile && 'min-h-11 py-3',
              )}
            >
              <Sparkles aria-hidden className="mt-0.75 h-3.5 w-3.5 shrink-0 text-ai-accent" />
              {/* 스펙 §4.3 최대 40자 — 좁은 패널·시트에서도 끝까지 읽히게 두 줄까지 감고, 낱말 중간에서 끊지 않는다. */}
              <span className="line-clamp-2 min-w-0 break-keep wrap-break-word">{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
