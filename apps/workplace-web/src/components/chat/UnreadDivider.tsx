// 미읽음 구분선 — "여기까지 읽음" 경계에 삽입. DateDivider 패턴 미러(좌우 선 + 중앙 라벨).
// id="unread-divider" 는 진입 시 스크롤 앵커(useStickToBottom 의 initialAnchorId)로 쓰인다.
// 강조를 위해 destructive 시맨틱 컬러 사용(날짜선과 시각 구분).

export function UnreadDivider() {
  return (
    <div
      id="unread-divider"
      className="flex items-center gap-2 py-1"
      data-testid="unread-divider"
      aria-label="여기까지 읽음"
    >
      <div className="flex-1 border-t border-destructive/50" />
      <span className="text-xs font-semibold text-destructive">여기까지 읽음</span>
      <div className="flex-1 border-t border-destructive/50" />
    </div>
  )
}
