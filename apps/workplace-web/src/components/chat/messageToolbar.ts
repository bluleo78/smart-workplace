import { nearestClippingAncestor } from '@/lib/nearestClippingAncestor'

// 메시지 작업 툴바(반응·스레드·수정·삭제)의 공용 외형·노출 클래스.
// 팀 채팅(MessageList)과 이슈 채팅(ChatMessageRow)이 같은 규칙을 쓰도록 한곳에 둔다.
// 위치(absolute 좌표)는 호출처가 메시지 종류에 따라 붙인다.
//
// #809: display:none(hidden) 이면 버튼이 tab 순서에서 빠져 키보드로 도달할 수 없다
// (포커스를 받아야 보이는데, 보여야 포커스를 받는 순환). 그래서 opacity 로만 숨기고
// 항상 레이아웃·tab 순서에 남긴다. 노출 경로는 세 가지다.
//   - 마우스: 행 hover (group-hover)
//   - 키보드: 행 안 포커스 (group-focus-within)
//   - 터치: 행 탭 (useToolbarReveal 이 행에 data-tap-active="true" 를 붙인다)
// 터치(coarse 포인터) 기기에서는 버튼을 44px 터치 타깃으로 키운다. 버튼은 호출처가 h-6 w-6 으로
// 그리므로 자손 선택자로 덮는다(선택자 우선순위가 더 높다). 이모지 피커 팝오버는 portal 이라 영향 없음.
export const MESSAGE_TOOLBAR_CLASS =
  'z-10 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 opacity-0 shadow-sm pointer-events-none transition-opacity ' +
  'pointer-coarse:[&_button]:size-11 pointer-coarse:[&_svg]:size-4 ' +
  'group-hover:pointer-events-auto group-hover:opacity-100 ' +
  'group-focus-within:pointer-events-auto group-focus-within:opacity-100 ' +
  'group-data-[tap-active=true]:pointer-events-auto group-data-[tap-active=true]:opacity-100'

// 본인(오른쪽) 컬럼의 첨부 목록 래퍼. 첨부 목록은 max-content 폭이라 긴 파일명이 컬럼(75%)을 넘어
// 왼쪽이 잘린다. w-full 로 컬럼 폭에 묶고 items-end 로 우측 정렬을 유지하며, 자식(이미지 span)은
// max-w-full 로 제한한다. 카드 버튼의 max-w-full min-w-0 는 MessageAttachmentList 가 직접 가진다.
export const OWN_ATTACHMENTS_CLASS = 'flex w-full min-w-0 flex-col items-end [&>*]:max-w-full'

// 본인 후속 줄의 hover 시각(말풍선 왼쪽 옆). 자리는 항상 예약하고 opacity 로만 토글해
// hover 전후로 행 높이·말풍선 위치가 변하지 않게 한다. 노출은 hover·터치 탭 두 경로.
export const HOVER_TIME_REVEAL_CLASS =
  'text-xs leading-4 tabular-nums text-muted-foreground whitespace-nowrap opacity-0 transition-opacity ' +
  'group-hover:opacity-100 group-data-[tap-active=true]:opacity-100'

// 툴바 위치(absolute 좌표). 기본은 "메시지 위"(Teams식)이고, 스크롤 영역 위 끝에 걸려 잘리면
// flipToolbarIfClipped 가 행에 data-toolbar-flip="true" 를 붙여 아래쪽으로 뒤집는다.
export const TOOLBAR_POSITION = {
  // 타인: 행 우상단 → 뒤집히면 행 우하단.
  peer: 'absolute -top-3 right-2 group-data-[toolbar-flip=true]:top-auto group-data-[toolbar-flip=true]:-bottom-3',
  // 본인·묶음 첫 줄: 시각 줄 안에서 시각 왼쪽(아래 끝 맞춤) → 뒤집히면 시각 줄 위 끝에 맞춰 아래로 늘어진다.
  ownHeader:
    'absolute bottom-0 right-full mr-1.5 group-data-[toolbar-flip=true]:bottom-auto group-data-[toolbar-flip=true]:top-0',
  // 본인·후속 줄: 말풍선 오른쪽 끝 위 → 뒤집히면 말풍선 아래.
  ownBubble:
    'absolute bottom-full right-0 group-data-[toolbar-flip=true]:bottom-auto group-data-[toolbar-flip=true]:top-full',
} as const

/**
 * 행의 툴바가 기본 위치(위쪽)에서 가장 가까운 스크롤 영역(없으면 창) 위 끝 밖으로 나가면 아래로 뒤집는다.
 * 툴바가 드러나는 순간(hover·포커스·터치 탭)마다 호출한다. opacity 0 이어도 레이아웃은 있으므로 측정된다.
 * 규칙을 위치별로 하드코딩하지 않고 툴바 자체의 박스를 재므로, 터치용 44px 툴바처럼 높이가 달라도 맞다.
 */
export function flipToolbarIfClipped(row: HTMLElement) {
  const toolbar = row.querySelector('[data-message-toolbar]')
  if (!toolbar) return
  // 이전 판정을 지우고 기본 위치에서 잰다(뒤집힌 채로 재면 항상 "안 잘림"으로 보인다).
  row.removeAttribute('data-toolbar-flip')
  const clipper = nearestClippingAncestor(row, null, 'y')
  const clipTop = clipper ? Math.max(0, clipper.getBoundingClientRect().top) : 0
  if (toolbar.getBoundingClientRect().top < clipTop) row.setAttribute('data-toolbar-flip', 'true')
}

// 모바일 터치 셸의 메시지 행 — 길게 누르기가 작업 시트를 열므로 iOS 텍스트 선택·콜아웃(복사/공유 말풍선)이 같이 뜨지 않게 막는다
// (복사는 시트가 제공). 수정 중인 행에는 붙이지 않는다 — 에디터에서 커서 이동·선택·붙여넣기가 되어야 한다(C2).
export const TOUCH_NO_SELECT_CLASS = 'select-none [-webkit-touch-callout:none]'
