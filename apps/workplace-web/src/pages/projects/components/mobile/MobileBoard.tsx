// 모바일 보드(WP-195, 시안 B) — 상단 상태 탭 + 선택 상태의 카드만 전체 폭 한 컬럼.
// 탭은 프로젝트 상태 하나에 하나(WP-808) — 탭 위 범주 색 띠로 할 일·진행 중·완료·취소를 구분한다.
// 탭 전환: 탭 누르기 또는 목록 영역 좌우 스와이프. 선택 탭(statusId)은 URL boardTab(replace)으로 유지 — 상세 갔다 뒤로·새로고침 복귀.
// 카드·sentinel 렌더는 호출처(IssueBoardView)가 children(statusId, root) 로 맡는다 — 데이터(컬럼 쿼리)는 그쪽에 있으므로.
// 탭 아래에 현재 상태 이름·개수 줄을 두고, menu 를 주면(OWNER 상태 보드) 그 줄에 ⋯(편집 바텀시트)를 붙인다(모바일 A안).
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CATEGORY_COLOR } from '@/components/issues/issueCategoryColor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHorizontalSwipe } from '@/hooks/useHorizontalSwipe';
import { useScrollTopWhenSettled } from '@/hooks/useScrollTopWhenSettled';
import { BOARD_TAB_PARAM, type BoardTabInfo, resolveBoardTab } from '@/lib/boardTabs';
import { withBoardTab } from '@/lib/issueFilters';
import { cn } from '@/lib/utils';

// refreshing — 조건을 바꿔 새 결과를 받는 중(이전 결과 자리채움, WP-1049). 수는 이전 조건의 것이라 비워 둔다.
export type MobileBoardTab = BoardTabInfo & { label: string; hasMore: boolean; refreshing?: boolean };

/** 탭·헤더의 수 — 받는 중이면 비우고, 아직 받지 않은 페이지가 있으면 「N+」. */
const tabCount = (t: MobileBoardTab) => (t.refreshing ? '' : `${t.count}${t.hasMore ? '+' : ''}`);

export function MobileBoard({
  tabs,
  band = true,
  menu,
  scrollReset,
  children,
}: {
  // 보일 상태 탭(표시 순서) — 상태 목록 로딩 중엔 빈 배열(기본 탭을 미리 고르지 않는다).
  tabs: MobileBoardTab[];
  // 탭 위 범주 색 띠(기본 표시). 개인 보드는 상태가 범주와 1:1 이라 데스크톱처럼 숨긴다.
  band?: boolean;
  // 현재 탭 헤더 줄의 ⋯ 편집 진입점(OWNER) — 없으면 헤더 줄에 이름·개수만 보인다.
  menu?: (statusId: number) => ReactNode;
  // 새 조건(key)의 결과가 모두 들어오면 목록을 맨 위로(WP-1049) — 받는 동안 이전 카드가 남아 있어 새 결과가 옛 스크롤 위치에 들어오지 않게.
  scrollReset?: { key: string; refreshing: boolean };
  children: (statusId: number, root: Element) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const active = resolveBoardTab(params.get(BOARD_TAB_PARAM), tabs);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const select = (statusId: number) => {
    setParams((prev) => withBoardTab(prev, statusId), { replace: true });
  };
  const swipe = useHorizontalSwipe((dir) => {
    const i = tabs.findIndex((t) => t.statusId === active);
    if (i < 0) return;
    const next = tabs[i + (dir === 'next' ? 1 : -1)];
    if (next) select(next.statusId);
  });

  // 탭이 저절로 바뀌지 않게 기본 탭을 첫 로드 후 URL 에 고정 — URL 에 boardTab 이 없으면 매 렌더 재계산되어,
  // 마지막 진행 중 카드를 다른 상태로 옮겨 탭이 비면 보드가 할 일 탭으로 튀고 스크롤도 맨 위로 간다.
  // 개수 로딩 중(pending)·상태 목록 로딩 중(탭 없음)에는 임시 기본값일 수 있어 고정하지 않는다.
  // 예전 범주 링크(boardTab=IN_PROGRESS)도 여기서 statusId 로 바뀐다.
  const urlTab = params.get(BOARD_TAB_PARAM);
  const settled = tabs.length > 0 && !tabs.some((t) => t.pending);
  useEffect(() => {
    // urlTab === active 가드로 멱등 — 고정 후엔 다시 쓰지 않는다.
    if (settled && active != null && urlTab !== String(active)) {
      setParams((prev) => withBoardTab(prev, active), { replace: true });
    }
  }, [settled, active, urlTab, setParams]);

  useScrollTopWhenSettled(scrollEl, scrollReset?.key ?? '', scrollReset?.refreshing ?? false);

  // 탭이 바뀌면 목록을 맨 위로 — 이전 탭의 스크롤 위치가 남아 sentinel 이 바로 보이거나 빈 화면처럼 보이지 않게.
  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 });
  }, [active, scrollEl]);

  // 선택 탭이 탭 줄 밖에 있으면(상태가 많을 때 새로고침·스와이프) 탭 줄만 가로로 옮겨 보이게 한다.
  // scrollIntoView 는 바깥 스크롤러(문서·본문)까지 움직이므로 쓰지 않는다. 탭 폭이 소수점이라 화면 좌표로 재고 올림한다.
  // settled 도 의존성 — 개수 응답이 늦게 와 탭 폭이 바뀐 뒤에도 한 번 더 맞춘다.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!list || !el) return;
    const box = list.getBoundingClientRect();
    const tab = el.getBoundingClientRect();
    if (tab.left < box.left) list.scrollLeft -= Math.ceil(box.left - tab.left);
    else if (tab.right > box.right) list.scrollLeft += Math.ceil(tab.right - box.right);
  }, [active, tabs.length, settled]);

  const current = tabs.find((t) => t.statusId === active);
  // 탭 루트가 탭 줄·현재 탭 헤더·목록을 함께 감싼다 — 목록 영역이 선택 탭의 TabsContent(role=tabpanel)라 탭의 aria-controls 가 그 패널을
  // 가리킨다(WP-841, 예전엔 패널이 없어 없는 id 를 가리켰다). 패널 value 를 늘 선택 탭으로 두어 탭이 바뀌어도 같은 요소를 다시 쓴다.
  return (
    <Tabs value={active == null ? '' : String(active)} onValueChange={(v) => select(Number(v))} className="h-full min-h-0 gap-0">
        {/* 상태가 많으면(30자 이름 포함) 가로 스크롤 — 문서 가로 스크롤은 막는다. 이름은 탭마다 말줄임(전체 이름은 title).
            기본 TabsList 의 h-9·p-[3px] 은 group-data 변형이라 같은 변형으로 덮어야 이긴다 — 안 덮으면 44px 탭이 36px 줄 안에서 세로 스크롤된다.
            활성 밑줄(after, 기본 bottom -5px)도 overflow 에 잘리므로 탭 안쪽 바닥(border-b 바로 위)으로 올린다. */}
        <TabsList
          ref={listRef}
          className="relative w-full shrink-0 justify-start overflow-x-auto border-b p-0 group-data-[orientation=horizontal]/tabs:h-auto"
          data-testid="board-tabs"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t.statusId}
              value={String(t.statusId)}
              // 기본 flex-1(basis 0)은 상태가 많으면 모든 탭을 min-w(72px)로 눌러 짧은 이름까지 말줄임한다 —
              // flex-auto 로 내용 폭을 기본으로 두고 남는 폭이 있을 때만 늘린다.
              className="h-11 flex-auto shrink-0 px-2 group-data-[orientation=horizontal]/tabs:after:bottom-0"
              data-testid={`board-tab-${t.statusId}`}
            >
              {/* 범주 색 띠 — 탭 위쪽 안에 띄워(absolute) 탭 높이 44px 를 늘리지 않는다. 색은 데스크톱 범주 띠와 같은 테두리 토큰. */}
              {band && (
                <span
                  aria-hidden="true"
                  className={cn('absolute inset-x-2 top-1 h-0 rounded-full border-t-[3px]', CATEGORY_COLOR[t.category].band)}
                  data-testid={`board-tab-band-${t.statusId}`}
                />
              )}
              <span className="max-w-40 truncate" title={t.label}>
                {t.label}
              </span>
              <span className="font-normal tabular-nums text-muted-foreground" data-testid={`board-tab-count-${t.statusId}`}>
                {tabCount(t)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      {/* 현재 탭 헤더(모든 역할·개인 보드, 모바일 A안) — 탭은 긴 이름을 말줄임하므로 여기서 전체 이름을 두 줄까지 보인다.
          ⋯(편집)는 OWNER 상태 보드(menu)에만, 늘 오른쪽 끝 44px. ⋯ 가 없어도 줄 높이(min-h-11)는 같다. */}
      {current && (
        <div className={cn('flex min-h-11 shrink-0 items-center justify-between gap-2 pl-3', !menu && 'pr-3')} data-testid="board-tab-header">
          <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold">
            <span className="line-clamp-2 break-words" title={current.label}>
              {current.label}
            </span>
            <span className="shrink-0 font-normal tabular-nums text-muted-foreground">
              {tabCount(current)}
            </span>
          </span>
          {menu?.(current.statusId)}
        </div>
      )}
      {/* 목록 영역 — 세로 스크롤 + 좌우 스와이프. pan-y: 수평 제스처를 브라우저가 가로채지 않게. sentinel 의 IO root. */}
      {active != null && (
        <TabsContent
          value={String(active)}
          ref={setScrollEl}
          className="min-h-0 touch-pan-y overflow-y-auto pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
          data-testid="board-scroll"
          {...swipe}
        >
          {/* 스크롤 루트가 잡힌 뒤에만 렌더 — 첫 렌더에 sentinel 관찰자가 viewport 를 root 로 잡지 않게. */}
          {scrollEl && children(active, scrollEl)}
        </TabsContent>
      )}
    </Tabs>
  );
}
