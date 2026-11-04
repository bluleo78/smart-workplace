// src/components/filter/FilterLine.tsx
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { HIDE_SCROLLBAR } from '@/lib/scrollStyles';
import { cn } from '@/lib/utils';

/**
 * 가로 스크롤 영역이 「오른쪽으로 더 스크롤될 수 있는가」를 알려 준다 — 넘침 페이드를 띄울 때만 쓴다(필터 줄 규칙 5).
 * 크기 변화(영역·직계 자식)와 스크롤 때, 그리고 렌더마다 다시 잰다. 끝에 닿으면(1px 오차 허용) false.
 */
function useCanScrollRight(ref: RefObject<HTMLElement | null>) {
  const [can, setCan] = useState(false);
  const measure = () => {
    const el = ref.current;
    setCan(!!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  // 칩이 바뀌어 폭이 달라졌을 수 있으므로 렌더마다 잰다(같은 값이면 setState 가 무시된다)
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return can;
}

/** 스크롤 영역 오른쪽 끝의 페이드 — 「더 있다」는 표시. 클릭은 아래 요소로 통과한다(MobileIssueToolbar 와 같은 방식). */
const FADE = 'pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background';

/**
 * 목록 위 필터 줄 — 키워드 필터·빠른 필터 칩·오른쪽 끝 묶음을 정해진 순서로 놓는다(WP-1355).
 * 화면마다 줄을 새로 짜지 않도록 슬롯만 받는다. 규칙: 디자인 시스템 05 「검색과 필터 > 필터 줄」.
 *
 * - 줄 폭 672px(@2xl 컨테이너 쿼리) 이상: 한 줄. 키워드 칸(w-64) → chips(늘 다 보임) → 오른쪽 end(줄지 않음).
 *   키워드가 160px 까지 줄어도 모자라면 end(와 뒤따르는 clear)만 둘째 줄 오른쪽으로 내려간다. chips 가 줄 폭보다 넓을 때만 이 묶음이 가로 스크롤.
 * - 그보다 좁으면(모바일·데스크톱의 좁은 칸 포함): 키워드 전폭 한 줄 + 그 아래 chips·end 를 한 줄 가로 스크롤(줄바꿈 없음).
 *   chips·end 가 둘 다 없으면 둘째 줄을 그리지 않는다.
 * - 슬롯 계약: 보일 것이 없는 슬롯은 호출부가 `undefined`(또는 null·false)를 넘긴다. Fragment(`<>…</>`)는 안이 비어도
 *   「있음」으로 보여 빈 둘째 줄이 생기므로, 슬롯을 그릴지는 호출부가 조건을 계산해 정한다.
 * - clear 슬롯: 「필터 지우기」처럼 스크롤로 사라지면 안 되는 것. 줄 맨 끝(한 줄: end 뒤, 좁은 줄: 둘째 줄 끝)에
 *   스크롤 밖·줄지 않게 놓인다. 없으면 undefined.
 * - 키워드 칸은 한 줄에서 chips 보다 먼저 줄어든다(256→160px). 그래도 chips 가 넘치면 스크롤 영역 오른쪽에 페이드가 뜨고 끝에 닿으면 사라진다.
 * - chips 안의 요소는 줄바꿈하지 않아야 한다(규칙 5) — chips 래퍼가 직계 자식에 flex-nowrap 을 걸어 호출부가 따로 알릴 필요가 없다.
 * - className·data-testid 는 바깥 루트(부모가 배치하는 요소)에 붙는다. role=toolbar 는 안쪽 줄이 가진다.
 */
export function FilterLine({
  keyword,
  chips,
  end,
  clear,
  className,
  'data-testid': testId,
}: {
  /** 키워드 필터 칸(보통 FilterInput) — 항상 맨 앞 */
  keyword: ReactNode;
  /** 빠른 필터·범위 칩 등 「무엇을 좁히나」. 없으면 undefined */
  chips?: ReactNode;
  /** 오른쪽 끝 「어떻게 보나」(정렬·보기 전환 등). 없으면 undefined */
  end?: ReactNode;
  /** 스크롤에 가려지면 안 되는 「필터 지우기」 등 — chips 스크롤 영역 밖. 없으면 undefined */
  clear?: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  // 0·''·false·null 은 「없음」 — 「0」 이 그려지거나 빈 둘째 줄이 생기지 않게 한다
  const has = (n: ReactNode) => n != null && n !== false && n !== '' && n !== 0;
  const hasRest = has(chips) || has(end) || has(clear);
  // 좁은 줄은 둘째 줄 스크롤 영역, 한 줄은 chips 스크롤 영역이 각각 넘침을 잰다(안 쓰는 쪽은 contents/비스크롤이라 늘 false)
  const restScrollRef = useRef<HTMLDivElement>(null);
  const chipsScrollRef = useRef<HTMLDivElement>(null);
  const restFade = useCanScrollRight(restScrollRef);
  const chipsFade = useCanScrollRight(chipsScrollRef);
  return (
    // 바깥 @container 가 줄 자신의 폭을 잰다 — 안쪽 줄의 @2xl: 분기는 뷰포트가 아니라 이 폭 기준이다.
    // 부모가 배치·여백을 주는 요소가 이 루트라 className·data-testid 를 여기에 둔다.
    <div className={cn('@container', className)} data-testid={testId}>
      <div role="toolbar" aria-label="필터" className="flex flex-col gap-2 @2xl:flex-row @2xl:flex-wrap @2xl:items-center">
        {/* 키워드: 좁은 폭은 전폭(FilterInput 의 max-w-sm 해제), 넓은 폭은 w-64. 한 줄에서는 chips 보다 먼저(shrink 4 대 1) min-w-40 까지 줄어든다 */}
        <div className="flex w-full [&>*]:max-w-none @2xl:w-64 @2xl:min-w-40 @2xl:[flex-shrink:4]">{keyword}</div>
        {hasRest && (
          // 둘째 줄(좁은 폭) 또는 한 줄의 직계 자식 묶음(넓은 폭 contents). 스크롤 영역과 clear 를 나란히 둔다.
          <div data-testid="filter-line-rest" className="flex min-w-0 items-center gap-2 @2xl:contents">
            {/* 좁은 폭: 한 줄 가로 스크롤(스크롤바 숨김) + 오른쪽 페이드. 넓은 폭: 이 두 겹을 풀어(contents) chips·end 가 루트의 직계 자식처럼 놓인다.
              세로(py-0.5)·가로(px-0.5) 여백은 스크롤 영역이 칩의 포커스 링을 자르지 않게 하는 몫이다. */}
            <div className="relative min-w-0 flex-1 @2xl:contents">
              <div
                ref={restScrollRef}
                className={cn('flex min-w-0 items-center gap-2 overflow-x-auto px-0.5 py-0.5 @2xl:contents', HIDE_SCROLLBAR)}
              >
                {has(chips) && (
                  // 넓은 폭: 바깥(relative)은 칩의 자연 폭을 지키고(줄지 않음 — 모자라면 끝 묶음이 둘째 줄로 내려간다) 줄 폭까지만 커지며 페이드를 얹고, 안쪽이 스크롤한다. 좁은 폭에서는 둘 다 평범한 shrink-0 묶음이다.
                  // 직계 자식 [&>*]:flex-nowrap 은 QuickFilterBar 같은 wrap 칩 묶음이 칩 줄 안에서 줄바꿈하지 않게 한다(규칙 5).
                  <div className="flex shrink-0 @2xl:relative @2xl:max-w-full @2xl:shrink-0">
                    <div
                      ref={chipsScrollRef}
                      // 넓은 폭의 스크롤바 숨김은 @2xl: 접두사가 붙어 HIDE_SCROLLBAR 를 쓸 수 없다 — Tailwind 는 정적 리터럴만 스캔한다.
                      className="flex shrink-0 items-center gap-2 @2xl:min-w-0 @2xl:shrink @2xl:overflow-x-auto @2xl:px-0.5 @2xl:py-0.5 @2xl:[scrollbar-width:none] @2xl:[&::-webkit-scrollbar]:hidden [&>*]:flex-nowrap [&>*]:shrink-0"
                    >
                      {chips}
                    </div>
                    {chipsFade && <div data-testid="filter-line-chips-fade" className={cn(FADE, 'hidden @2xl:block')} aria-hidden="true" />}
                  </div>
                )}
                {/* DOM 순서 = 보이는 순서 = Tab 순서: chips → end → clear(줄 끝). CSS order 로 바꾸지 않는다(키보드 순서가 어긋남) */}
                {has(end) && <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>}
              </div>
              {restFade && <div data-testid="filter-line-rest-fade" className={cn(FADE, '@2xl:hidden')} aria-hidden="true" />}
            </div>
            {has(clear) && (
              // 스크롤 밖·줄지 않음 — 칩이 넘쳐도 「필터 지우기」는 늘 보인다
              <div data-testid="filter-line-clear" className="flex shrink-0 items-center">
                {clear}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
