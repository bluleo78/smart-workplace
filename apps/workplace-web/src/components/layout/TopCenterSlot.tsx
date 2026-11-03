// 상단 가운데 고정 틀(WP-1324) — AI 칩과 그 오른쪽 전역 이슈 검색이 함께 쓰는 자리. 비서 없는 워크스페이스에서는 검색만 둔다.
// 칩만 있던 때 AIChip 이 맡던 위치 계산을 여기로 옮겼다 — AI 와 무관한 검색이 AI 칩 컴포넌트에 기대지 않게.
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

const TOP_CENTER_POSITION =
  // 데스크톱(lg+): 뷰포트 중앙(+28 AppRail 보정)에 고정하되, 사이드 패널이 칩을
  // 침범할 만큼 넓어지면(#195) 그때만 콘텐츠 영역 쪽으로 클램프한다. min() 의 두 항:
  //  1) calc(50%+28px)            — 기본 정적 중앙(패널 닫힘/좁음일 땐 항상 이 값)
  //  2) calc(100%-패널폭-108px)   — 칩 오른쪽 검색 아이콘(WP-1324: 반폭 70 + 간격 8 + 아이콘 30)이 패널 좌단에 닿는 최댓값
  // 패널이 좁으면 (2)>(1) 이라 정적 유지, 넓으면 (2)<(1) 이라 좌측으로 밀려 비겹침 보장.
  // --ai-side-width 미설정(closed/fullscreen/모바일)이면 (2)=100%-108px 라 항상 (1) 채택.
  // 펼친 검색 칸은 옆 패널이 열려 있으면 왼쪽으로 펼쳐져(GlobalIssueSearch) 패널을 덮지 않는다.
  // 모바일은 AppRail 보정이 불필요하므로 left-1/2 유지.
  // WP-1261: pointer-events-auto — 패널이 닫힌 채 modal 다이얼로그(첨부 미리 보기 등)가 열리면 Radix 가 body 에
  // pointer-events:none 을 거는데, body 직속 포털인 칩도 그 차단을 물려받아 눌리지 않았다. 칩만 다시 받게 한다
  // (data-ai-panel 이라 다이얼로그는 닫히지 않고, side 로 바뀌면 다이얼로그가 non-modal 로 다시 마운트돼 패널 옆으로 비켜선다).
  'pointer-events-auto fixed left-1/2 top-2 z-[70] -translate-x-1/2 transition-[left] duration-200 ease-in-out panel-resizing:transition-none lg:left-[min(calc(50%+28px),calc(100%-var(--ai-side-width,0px)-108px))]';

/**
 * 상단 가운데 고정 틀. children 이 가운데에 서고, trailing 은 그 오른쪽에 떠서(absolute) 가운데 자리를 바꾸지 않는다.
 * data-ai-chip: 페이지 헤더 좌측 그룹이 이 틀의 실제 위치를 재서 겹치지 않게 자른다(useAiChipClamp — left 전환도 이 틀에서 일어난다).
 */
export function TopCenterSlot({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return createPortal(
    <div data-ai-chip className={TOP_CENTER_POSITION}>
      {children}
      {/* ml-2(8px) — TOP_CENTER_POSITION 의 108px(칩 반폭 70 + 8 + 검색 아이콘 30)와 맞물린다. */}
      {trailing && <div className="absolute left-full top-0 ml-2">{trailing}</div>}
    </div>,
    document.body,
  );
}

