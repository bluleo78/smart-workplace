// 상단 가운데 고정 틀(WP-1324, 검색은 WP-1353 에서 팔레트로 교체) — AI 칩과 그 오른쪽 통합 검색·도움말(WP-1505) 단추가 함께 쓰는 자리.
// 비서 없는 워크스페이스에서는 검색이 가운데, 도움말이 그 오른쪽에 선다.
// 칩만 있던 때 AIChip 이 맡던 위치 계산을 여기로 옮겼다 — AI 와 무관한 검색이 AI 칩 컴포넌트에 기대지 않게.
// WP-1611: 앞 단계(접기·동그라미)를 다 써도 제목 자리가 모자라면(docked) 틀을 숨기고 같은 단추를 페이지 헤더 안(오른쪽 액션 앞)에 그린다.
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { HEADER_DOCK_SELECTOR } from '@/components/layout/headerDensity';
import { useActiveDensityHeader, useHeaderDensity } from '@/components/layout/HeaderDensityContext';
import { useAiActionsWidth } from '@/components/layout/useAiActionsWidth';
import { cn } from '@/lib/utils';

const TOP_CENTER_POSITION =
  // 데스크톱(lg+): 뷰포트 중앙(+28 AppRail 보정)에 고정하되, 사이드 패널이 칩을
  // 침범할 만큼 넓어지면(#195) 그때만 콘텐츠 영역 쪽으로 클램프한다. min() 의 항(패널폭 = --right-dock-width, AI 패널 + 도움말 패널):
  //  1) calc(50%+28px)                         — 기본 정적 중앙(패널 닫힘/좁음일 땐 항상 이 값)
  //  2) calc(100%-패널폭-150px)                — 칩 오른쪽 「?」 단추가 패널 좌단에 닿는 최댓값
  //  3) calc(100%-패널폭-액션폭-var(--ai-chip-offset)) — 헤더 우측 단추가 칩을 침범할 때(WP-1415) 그 앞(16px)에서 멈추는 최댓값
  // 2 항의 150px 는 칩 반폭(70) + 간격(8) + 검색 32 + 간격(8) + 「?」 32 에 맞물린다(WP-1505 에서 110 → 150).
  // 3 항의 --ai-chip-offset 는 칩 반폭에 맞물려 바뀐다(useAiActionsWidth) — 일반 칩(140px) 182px, 동그라미(32px) 128px.
  // (오프셋 = 128 + (칩폭-32)/2: 128px 는 동그라미 반폭 16 + 간격 8 + 검색 32 + 간격 8 + 「?」 32 + 간격 16 + 여백 16.)
  // 도움말 패널이 오른쪽에 붙으면(WP-1505) 그 폭도 패널폭에 들어 2·3 항에서 함께 빠진다 — 칩·검색·「?」가 도움말 아래로 들어가지 않게.
  // 패널·액션이 좁으면 (2)(3)>(1) 이라 정적 유지, 넓으면 <(1) 이라 좌측으로 밀려 비겹침 보장.
  // 두 패널 닫힘(패널폭 0)·--ai-actions-width 미설정(모바일)이면 (2)=100%-150px·(3)=100%-오프셋.
  // 검색은 이 자리에서 펼치지 않고 가운데 모달 팔레트(SearchPalette)로 열리므로 이 틀의 크기에 영향이 없다.
  // 모바일은 AppRail 보정이 불필요하므로 left-1/2 유지.
  // WP-1261: pointer-events-auto — 패널이 닫힌 채 modal 다이얼로그(첨부 미리 보기 등)가 열리면 Radix 가 body 에
  // pointer-events:none 을 거는데, body 직속 포털인 칩도 그 차단을 물려받아 눌리지 않았다. 칩만 다시 받게 한다
  // (data-ai-panel 이라 다이얼로그는 닫히지 않고, side 로 바뀌면 다이얼로그가 non-modal 로 다시 마운트돼 패널 옆으로 비켜선다).
  'fixed left-1/2 top-3 z-[70] -translate-x-1/2 transition-[left] duration-200 ease-in-out panel-resizing:transition-none lg:left-[min(calc(50%+28px),calc(100%-var(--right-dock-width)-150px),calc(100%-var(--right-dock-width)-var(--ai-actions-width,0px)-var(--ai-chip-offset,182px)))]';

/**
 * 단추 묶음을 담는 상자 — React 포털의 대상이며, 이 상자 자체를 떠 있는 틀 ↔ 헤더 자리 사이로 옮긴다.
 * display:contents 라 상자는 상자를 만들지 않고 안의 단추가 놓인 곳(틀·헤더 자리의 flex)의 자식처럼 배치된다.
 */
function createButtonBox() {
  const box = document.createElement('div');
  box.style.display = 'contents';
  return box;
}

/**
 * 상단 가운데 고정 틀. children 이 가운데에 서고, trailing(검색·「?」 등)은 그 오른쪽에 8px 간격으로 나란히 떠서(absolute) 가운데 자리를 바꾸지 않는다.
 * data-ai-chip: 페이지 헤더 좌측 그룹이 이 틀의 실제 위치를 재서 겹치지 않게 자른다(useAiChipClamp — left 전환도 이 틀에서 일어난다).
 *
 * 헤더 넣기(docked, WP-1611)에서 단추를 「다시 그리지 않고 옮긴다」 — 왜:
 * 포털 대상을 바꾸면(createPortal(buttons, 다른 요소)) React 는 단추를 언마운트 → 다시 마운트한다. 그러면
 *  - 포커스가 body 로 떨어진다 — ✕ 로 도움말을 닫아 「?」로 돌려받은 포커스(WP-1505)가 가운데 복귀와 함께 사라지고,
 *    키보드로 「?」·AI 칩을 눌러 패널이 열리며 헤더로 들어가면 누른 단추가 없어진다.
 *  - SearchTrigger 가 내려가며 팔레트를 닫고(useSearchPaletteSession 정리), 팔레트 본문의 검색어(지역 상태)도 지워진다.
 * 그래서 단추는 늘 같은 두 상자(chipBox·trailingBox)에 한 번만 포털하고(React 쪽 대상은 바뀌지 않아 다시 마운트가 없다),
 * 상자 DOM 만 레이아웃 효과에서 떠 있는 틀의 빈 자리 ↔ 헤더 자리([data-ai-header-dock]) 사이로 옮긴다.
 * React 와 안전한 이유: 상자를 넣는 곳은 React 가 자식을 그리지 않는 빈 요소뿐이라(틀의 두 자리 div·헤더 자리 div) React 의 자식 목록과 섞이지 않고,
 * 포털 이벤트는 포털 대상(상자)에 붙은 리스너가 받으므로 상자가 어디로 옮겨져도 그대로 동작한다.
 * 다른 방안(다시 마운트 + testid 로 포커스 되찾기 + 팔레트 닫기 미루기)은 팔레트 검색어처럼 단추 아래 지역 상태를 지킬 수 없어 택하지 않았다.
 * DOM 이동(appendChild)은 브라우저가 포커스를 잃게 하므로, 옮기기 전에 상자 안에 포커스가 있었으면 옮긴 뒤 같은 요소에 되돌린다.
 */
export function TopCenterSlot({ children, trailing, densityChip = false }: {
  children: ReactNode;
  trailing?: ReactNode;
  /** children 이 밀도 칩(AIChip, data-ai-density-chip)인지 — 헤더에 넣은 동안 숨긴 틀의 자리 표시가 같은 표식을 이어받아 동그라미 단계 판정이 유지된다. */
  densityChip?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  /** 떠 있을 때 chipBox 가 놓이는 자리(틀 가운데). */
  const chipSpotRef = useRef<HTMLDivElement>(null);
  /** 떠 있을 때 trailingBox 가 놓이는 자리(틀 오른쪽 absolute 줄). */
  const trailingSpotRef = useRef<HTMLDivElement>(null);
  // 단추 묶음 상자는 마운트 동안 하나로 고정한다 — 포털 대상이 바뀌지 않아야 단추가 다시 마운트되지 않는다.
  const [chipBox] = useState(createButtonBox);
  const [trailingBox] = useState(createButtonBox);
  // 헤더 우측 액션 폭을 --ai-actions-width 로 넘긴다(3 번째 min() 항) — 칩 포털이 body 직속이라 액션 폭을 CSS 로 알 수 없기 때문.
  useAiActionsWidth();
  const { docked } = useHeaderDensity();
  const header = useActiveDensityHeader();
  // 헤더 넣기 단계에서만 헤더 안 자리를 찾는다. 자리는 헤더가 늘 그려 두므로(숨김) 같은 커밋에 이미 DOM 에 있다.
  // 못 찾으면(헤더가 막 바뀌는 중) 떠 있는 틀을 그대로 보인다 — 단추가 사라지는 프레임을 만들지 않는다.
  const dock = docked ? header?.querySelector<HTMLElement>(HEADER_DOCK_SELECTOR) ?? null : null;

  // 상자를 지금 자리(헤더 자리 또는 틀의 두 자리)로 옮긴다. 페인트 전에 끝내 단추가 빈 자리에 있는 프레임이 없다.
  useLayoutEffect(() => {
    const chipTarget = dock ?? chipSpotRef.current;
    const trailingTarget = dock ?? trailingSpotRef.current;
    if (!chipTarget || !trailingTarget) return;
    if (chipBox.parentNode === chipTarget && trailingBox.parentNode === trailingTarget) return;
    // 옮기면 포커스가 떨어지므로 상자 안에 있던 포커스를 기억했다가 같은 요소에 돌려준다(WP-1505 포커스 복귀 유지).
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && (chipBox.contains(active) || trailingBox.contains(active)) ? active : null;
    // 헤더 자리에서는 같은 줄에 칩 → 검색 → 「?」 순서로 선다.
    chipTarget.append(chipBox);
    trailingTarget.append(trailingBox);
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }, [dock, chipBox, trailingBox]);

  // 내려갈 때 상자를 걷는다 — 헤더 자리에 빈 상자가 남지 않게. (StrictMode 재실행이면 위 효과가 다시 붙인다.)
  useLayoutEffect(() => () => {
    chipBox.remove();
    trailingBox.remove();
  }, [chipBox, trailingBox]);

  return (
    <>
      {createPortal(
        // 헤더에 넣은 동안에도 틀은 마운트한 채 숨긴다(WP-1611) — 밀도 측정(HeaderDensityContext)이 이 틀의 자리로
        // 「가운데로 돌아가면 남을 제목 자리」를 재고, useAiActionsWidth 도 계속 위치 변수를 넘긴다.
        // 그동안 단추 상자는 헤더로 옮겨 가 있고 틀에는 같은 폭(32px 동그라미)의 빈 자리만 남는다 — 단추·testid 는 늘 한 곳에만 있다.
        // 보이지도 눌리지도 읽히지도 않게(invisible·pointer-events-none·aria-hidden·inert).
        <div
          ref={frameRef}
          data-ai-chip
          data-ai-docked={dock ? '' : undefined}
          aria-hidden={dock ? true : undefined}
          inert={dock ? true : undefined}
          className={cn(TOP_CENTER_POSITION, dock ? 'pointer-events-none invisible' : 'pointer-events-auto')}
        >
          {/* chipBox 가 들어오는 자리 — React 는 이 안에 아무것도 그리지 않는다(상자는 레이아웃 효과가 넣는다). */}
          <div ref={chipSpotRef} className="contents" />
          {dock && <span className="block h-8 w-8" data-ai-density-chip={densityChip ? '' : undefined} />}
          {/* trailingBox 가 들어오는 자리. ml-2·gap-2(8px) — TOP_CENTER_POSITION 의 150px(칩 반폭 70 + 8 + 검색 32 + 8 + 「?」 32)와 맞물린다. */}
          <div ref={trailingSpotRef} className="absolute left-full top-0 ml-2 flex gap-2" />
        </div>,
        document.body,
      )}
      {/* 단추는 위치와 상관없이 늘 같은 상자에 그린다 — 헤더 ↔ 가운데를 오가도 다시 마운트되지 않는다. */}
      {createPortal(children, chipBox)}
      {trailing != null && createPortal(trailing, trailingBox)}
    </>
  );
}
