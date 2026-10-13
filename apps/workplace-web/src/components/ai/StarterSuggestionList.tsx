// 빈 AI 대화 추천 질문 목록(WP-139, 시안 C) — 입력 영역 맨 위, 화면 참고 칩 바로 위. 작은 머리말 + 한 줄에 하나씩 세로 목록.
// 좁은 시트(키보드가 열린 모바일)에서는 목록만 줄어 안에서 스크롤한다(포커스 링은 안쪽으로 그려 잘리지 않게).
// 이때 목록 높이를 온전히 들어가는 마지막 행까지로 묶어, 행이 글자 중간에서 반쯤 잘려 보이지 않게 한다(useWholeRowsCap).
// 행: 앞에 ai-accent 아이콘, 화살표·강조 배경 없음, hover 시 bg-muted, 모바일 44px 이상. 긴 문구(최대 40자)는 두 줄까지 감는다.
// 목록이 바뀌면 짧게 페이드인(동작 줄이기 존중).
import { Sparkles } from 'lucide-react';
import { type RefObject, useId, useLayoutEffect, useRef } from 'react';

import type { StarterSuggestions } from '@/hooks/useStarterSuggestions';
import { cn } from '@/lib/utils';

interface Props extends StarterSuggestions {
  /** 전송이 막힌 상태(답변 중·동시 답변 상한·다른 창 답변 중) — 행을 비활성으로 그린다. 이력을 읽는 중에는 목록 자체를 그리지 않는다. */
  disabled: boolean;
  /** 모바일 — 행 높이 44px 이상(10-accessibility 터치 타깃). */
  isMobile: boolean;
  /**
   * 전체화면 AI — 목록 시작점을 입력창(＋ 첨부 버튼 36px + 간격 8px 오른쪽)에 맞추고, 행은 문구 폭만큼만 차지한다.
   * 넓은 화면에서 hover 띠·클릭 영역이 화면 가로로 깔리지 않게. 사이드 패널·시트는 행 전체 폭을 그대로 누른다.
   */
  alignToInput?: boolean;
  onPick: (query: string) => void;
}

export function StarterSuggestionList({ heading, items, holdProps, disabled, isMobile, alignToInput = false, onPick }: Props) {
  const headingId = useId();
  const listKey = items.join('\u0001');
  const listRef = useRef<HTMLUListElement>(null);
  useWholeRowsCap(listRef, listKey);
  return (
    <div
      data-testid="starter-suggestions"
      role="group"
      aria-labelledby={headingId}
      className={cn('mb-2 flex min-h-0 flex-col', alignToInput && 'pl-11')}
      {...holdProps}
    >
      <p id={headingId} className="mb-0.5 shrink-0 px-2 text-xs font-medium text-muted-foreground">{heading}</p>
      {/* key 로 목록이 바뀔 때만 다시 마운트해 페이드인 — 같은 목록에서는 깜빡이지 않는다.
          relative — 행의 offsetTop 기준을 목록으로 잡아 스크롤 위치와 무관하게 행 아래끝을 잰다(useWholeRowsCap). */}
      <ul
        key={listKey}
        ref={listRef}
        data-testid="starter-suggestion-list"
        className="relative min-h-0 overflow-y-auto animate-in fade-in-0 duration-150 motion-reduce:animate-none"
      >
        {items.map((q) => (
          <li key={q}>
            <button
              type="button"
              data-testid="starter-suggestion"
              disabled={disabled}
              onClick={() => onPick(q)}
              // 두 줄로 감길 수 있어 아이콘은 첫 줄에 맞춘다(items-start + 첫 줄 가운데 mt). 모바일 py-3 — 한 줄이면 정확히 44px.
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
                alignToInput ? 'w-fit max-w-full' : 'w-full',
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

/**
 * 목록이 받은 높이(flex 로 줄어든 높이)에 행이 반쯤 걸리면, 온전히 들어가는 마지막 행 아래끝까지로 max-height 를 묶는다.
 * 키보드가 열린 모바일 시트처럼 목록이 내용보다 낮아질 때 둘째 행이 글자 중간에서 잘리던 문제(UI 리뷰 #1) — 스크롤은 그대로 된다.
 * 행 높이는 두 줄 감김 때문에 일정하지 않아 고정 배수로는 못 맞춘다 — 매번 묶음을 풀고 실제 행 위치를 재서 다시 묶는다.
 * 패널 루트(입력 form 의 부모)를 관찰한다 — 목록·form 은 묶을 때마다 크기가 바뀌어 관찰하면 되먹임 고리가 생기고,
 * 루트는 시트 높이(키보드)·창 크기에만 따라 바뀐다. 남는 몇 px 는 위쪽 대화 영역(flex-1)이 가져간다.
 */
function useWholeRowsCap(ref: RefObject<HTMLUListElement | null>, listKey: string) {
  useLayoutEffect(() => {
    const ul = ref.current;
    if (!ul) return;
    const fit = () => {
      // 묶음을 풀어 flex 가 주는 높이를 다시 받는다 — 같은 동기 구간 안이라 그리기 전에 다시 묶인다.
      ul.style.maxHeight = '';
      const available = ul.clientHeight;
      if (ul.scrollHeight <= available) return;
      let bottom = 0;
      for (const li of Array.from(ul.children) as HTMLElement[]) {
        const rowBottom = li.offsetTop + li.offsetHeight;
        if (rowBottom > available) break;
        bottom = rowBottom;
      }
      // 한 행도 온전히 안 들어가면 묶지 않는다(0 으로 묶으면 목록이 사라진다).
      if (bottom > 0) ul.style.maxHeight = `${bottom}px`;
    };
    fit();
    const root = ul.closest('form')?.parentElement ?? ul.parentElement;
    const observer = new ResizeObserver(fit);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [ref, listKey]);
}
