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
