// 스크린리더용 "메시지 작업" 버튼(A1) — 터치 셸은 hover 툴바를 그리지 않아, VoiceOver·TalkBack 사용자에겐 길게 누르기만 남는다.
// 길게 누르기는 보조 기술에서 찾기 어렵고 제스처도 번거로우므로, 행마다 시각적으로 숨긴(sr-only) 버튼을 두어 같은 작업 시트를 연다.
// 화면에는 보이지 않고(1px·absolute — 행이 relative 라 레이아웃 영향 없음), 포커스·활성화는 된다.
// 렌더 조건은 길게 누르기와 같다(터치 셸 + 이 메시지에 작업이 있음) — 호출처가 onOpen 을 줄 때만 그린다.
export function MessageActionsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="sr-only" aria-haspopup="dialog" onClick={onOpen}>
      메시지 작업
    </button>
  )
}
