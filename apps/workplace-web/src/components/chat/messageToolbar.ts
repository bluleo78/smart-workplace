// 메시지 작업 툴바(반응·스레드·수정·삭제)의 공용 외형·노출 클래스.
// 팀 채팅(MessageList)과 이슈 채팅(ChatMessageRow)이 같은 규칙을 쓰도록 한곳에 둔다.
// 위치(absolute 좌표)는 호출처가 메시지 종류에 따라 붙인다.
//
// #809: display:none(hidden) 이면 버튼이 tab 순서에서 빠져 키보드로 도달할 수 없다
// (포커스를 받아야 보이는데, 보여야 포커스를 받는 순환). 그래서 opacity 로만 숨기고
// 항상 레이아웃·tab 순서에 남긴다. 노출 경로는 세 가지다.
//   - 마우스: 행 hover (group-hover)
//   - 키보드: 행 안 포커스 (group-focus-within)
//   - 터치: 행 탭 (useTapReveal 이 행에 data-tap-active="true" 를 붙인다)
export const MESSAGE_TOOLBAR_CLASS =
  'z-10 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 opacity-0 shadow-sm pointer-events-none transition-opacity ' +
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
