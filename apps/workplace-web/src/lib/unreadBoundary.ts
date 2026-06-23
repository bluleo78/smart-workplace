// 미읽음 경계 계산 — 채널 메시지 목록과 읽음 워터마크로 "첫 미읽음 메시지 id" 를 구한다.
// 이 값 앞에 "여기까지 읽음" 구분선을 그리고, 진입 시 그 위치로 스크롤한다.
// watermark 보다 id 가 큰 메시지가 미읽음. 위에 읽은 메시지가 있어야(중간 경계) 구분선을 표시한다.
export function firstUnreadMessageId(
  messages: { id: number }[],
  watermark: number | null,
): number | null {
  if (watermark == null) return null
  const ids = messages.map((m) => m.id)
  // 위에 읽은 메시지가 없으면(전부 미읽음) 경계가 아니라 "채널 시작" → 구분선 없음.
  if (!ids.some((id) => id <= watermark)) return null
  const unread = ids.filter((id) => id > watermark)
  if (unread.length === 0) return null
  return Math.min(...unread)
}
