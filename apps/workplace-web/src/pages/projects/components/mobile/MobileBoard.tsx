// 모바일 보드(WP-195, 시안 B) — 상단 상태 탭 + 선택 상태의 카드만 전체 폭 한 컬럼.
// 탭 전환: 탭 누르기 또는 목록 영역 좌우 스와이프. 선택 탭은 URL boardTab(replace)으로 유지 — 상세 갔다 뒤로·새로고침 복귀.
// 카드·sentinel 렌더는 호출처(IssueBoardView)가 children(status, root) 로 맡는다 — 데이터(컬럼 쿼리)는 그쪽에 있으므로.
import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHorizontalSwipe } from '@/hooks/useHorizontalSwipe';
import { BOARD_TAB_PARAM, type BoardTabInfo, resolveBoardTab } from '@/lib/boardTabs';

export type MobileBoardTab = BoardTabInfo & { label: string; hasMore: boolean };

export function MobileBoard({
  tabs,
  children,
}: {
  tabs: MobileBoardTab[];
  children: (status: string, root: Element | null) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const active = resolveBoardTab(params.get(BOARD_TAB_PARAM), tabs);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const select = (status: string) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      n.set(BOARD_TAB_PARAM, status);
      return n;
    }, { replace: true });
  };
  const swipe = useHorizontalSwipe((dir) => {
    const i = tabs.findIndex((t) => t.status === active);
    const next = tabs[i + (dir === 'next' ? 1 : -1)];
    if (next) select(next.status);
  });

  // 탭이 바뀌면 목록을 맨 위로 — 이전 탭의 스크롤 위치가 남아 sentinel 이 바로 보이거나 빈 화면처럼 보이지 않게.
  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 });
  }, [active, scrollEl]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={active} onValueChange={select} className="shrink-0 gap-0">
        {/* 탭 4개(개인 3개)는 390px 에 들어가지만, 상태가 늘면 가로 스크롤 — 문서 가로 스크롤은 막는다.
            기본 TabsList 의 h-9·p-[3px] 은 group-data 변형이라 같은 변형으로 덮어야 이긴다 — 안 덮으면 44px 탭이 36px 줄 안에서 세로 스크롤된다.
            활성 밑줄(after, 기본 bottom -5px)도 overflow 에 잘리므로 탭 안쪽 바닥(border-b 바로 위)으로 올린다. */}
        <TabsList
          className="w-full justify-start overflow-x-auto border-b p-0 group-data-[orientation=horizontal]/tabs:h-auto"
          data-testid="board-tabs"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t.status}
              value={t.status}
              className="h-11 min-w-0 px-2 group-data-[orientation=horizontal]/tabs:after:bottom-0"
              data-testid={`board-tab-${t.status}`}
            >
              {t.label}
              <span className="font-normal text-muted-foreground" data-testid={`board-tab-count-${t.status}`}>
                {t.count}
                {t.hasMore ? '+' : ''}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {/* 목록 영역 — 세로 스크롤 + 좌우 스와이프. pan-y: 수평 제스처를 브라우저가 가로채지 않게. sentinel 의 IO root. */}
      <div
        ref={setScrollEl}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
        data-testid="board-scroll"
        {...swipe}
      >
        {active && children(active, scrollEl)}
      </div>
    </div>
  );
}
