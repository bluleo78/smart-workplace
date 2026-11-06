// 상단 가운데 고정 틀(WP-1324, 검색은 WP-1353 에서 팔레트로 교체) — AI 칩과 그 오른쪽 통합 검색 트리거가 함께 쓰는 자리. 비서 없는 워크스페이스에서는 검색만 둔다.
// 칩만 있던 때 AIChip 이 맡던 위치 계산을 여기로 옮겼다 — AI 와 무관한 검색이 AI 칩 컴포넌트에 기대지 않게.
import { type ReactNode, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useAiActionsWidth } from '@/components/layout/useAiActionsWidth';

const TOP_CENTER_POSITION =
  // 데스크톱(lg+): 뷰포트 중앙(+28 AppRail 보정)에 고정하되, 사이드 패널이 칩을
  // 침범할 만큼 넓어지면(#195) 그때만 콘텐츠 영역 쪽으로 클램프한다. min() 의 항:
  //  1) calc(50%+28px)                         — 기본 정적 중앙(패널 닫힘/좁음일 땐 항상 이 값)
  //  2) calc(100%-패널폭-110px)                — 칩 오른쪽 검색 아이콘(반폭 70 + 간격 8 + 아이콘 32)이 패널 좌단에 닿는 최댓값
  //  3) calc(100%-패널폭-액션폭-var(--ai-chip-offset)) — 헤더 우측 단추가 칩을 침범할 때(WP-1415) 그 앞(16px)에서 멈추는 최댓값
  // 2 항의 110px 는 칩 반폭(70) + 간격(8) + 검색 아이콘(32)에 맞물린다.
  // 3 항의 --ai-chip-offset 는 칩 반폭에 맞물려 바뀐다(useAiActionsWidth) — 일반 칩(140px) 142px, 동그라미(32px) 88px.
  // (오프셋 = 88 + (칩폭-32)/2: 88px 는 동그라미 반폭 16 + 간격 8 + 검색 32 + 간격 16 + 여백 16.)
  // 패널·액션이 좁으면 (2)(3)>(1) 이라 정적 유지, 넓으면 <(1) 이라 좌측으로 밀려 비겹침 보장.
  // --ai-side-width·--ai-actions-width 미설정(closed/모바일)이면 (2)=100%-110px·(3)=100%-오프셋.
  // 검색은 이 자리에서 펼치지 않고 가운데 모달 팔레트(SearchPalette)로 열리므로 이 틀의 크기에 영향이 없다.
  // 모바일은 AppRail 보정이 불필요하므로 left-1/2 유지.
  // WP-1261: pointer-events-auto — 패널이 닫힌 채 modal 다이얼로그(첨부 미리 보기 등)가 열리면 Radix 가 body 에
  // pointer-events:none 을 거는데, body 직속 포털인 칩도 그 차단을 물려받아 눌리지 않았다. 칩만 다시 받게 한다
  // (data-ai-panel 이라 다이얼로그는 닫히지 않고, side 로 바뀌면 다이얼로그가 non-modal 로 다시 마운트돼 패널 옆으로 비켜선다).
  'pointer-events-auto fixed left-1/2 top-3 z-[70] -translate-x-1/2 transition-[left] duration-200 ease-in-out panel-resizing:transition-none lg:left-[min(calc(50%+28px),calc(100%-var(--ai-side-width,0px)-110px),calc(100%-var(--ai-side-width,0px)-var(--ai-actions-width,0px)-var(--ai-chip-offset,142px)))]';

/**
 * 상단 가운데 고정 틀. children 이 가운데에 서고, trailing 은 그 오른쪽에 떠서(absolute) 가운데 자리를 바꾸지 않는다.
 * data-ai-chip: 페이지 헤더 좌측 그룹이 이 틀의 실제 위치를 재서 겹치지 않게 자른다(useAiChipClamp — left 전환도 이 틀에서 일어난다).
 */
export function TopCenterSlot({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  // 헤더 우측 액션 폭을 --ai-actions-width 로 넘긴다(3 번째 min() 항) — 칩 포털이 body 직속이라 액션 폭을 CSS 로 알 수 없기 때문.
  useAiActionsWidth();
  return createPortal(
    <div ref={frameRef} data-ai-chip className={TOP_CENTER_POSITION}>
      {children}
      {/* ml-2(8px) — TOP_CENTER_POSITION 의 110px(칩 반폭 70 + 8 + 검색 아이콘 32)와 맞물린다. */}
      {trailing && <div className="absolute left-full top-0 ml-2">{trailing}</div>}
    </div>,
    document.body,
  );
}
