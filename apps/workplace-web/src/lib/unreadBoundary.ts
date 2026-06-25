// 미읽음 경계 계산 — 채널 메시지 목록과 읽음 워터마크로 "첫 미읽음 메시지 id" 를 구한다.
// 이 값 앞에 "여기까지 읽음" 구분선을 그리고, 진입 시 그 위치로 스크롤한다.
// watermark 보다 id 가 큰 메시지가 미읽음. 위에 읽은 메시지가 있어야(중간 경계) 구분선을 표시한다.
// 단, 내가(currentUserId) 작성한 메시지는 watermark 초과여도 미읽음이 아니다 — 진입-고정 watermark 는
// 내 전송으로 갱신되지 않으므로, author 필터 없이는 진입 후 내가 보낸 메시지가 미읽음으로 잡혀
// 유령 구분선/캐치업이 부활한다(#491). currentUserId 미지정 시 author 필터를 건너뛴다(하위호환).
export function firstUnreadMessageId(
  messages: { id: number; authorId?: number }[],
  watermark: number | null,
  currentUserId?: number | null,
): number | null {
  if (watermark == null) return null
  const ids = messages.map((m) => m.id)
  // 위에 읽은 메시지가 없으면(전부 미읽음) 경계가 아니라 "채널 시작" → 구분선 없음.
  if (!ids.some((id) => id <= watermark)) return null
  const unread = messages
    .filter((m) => m.id > watermark && (currentUserId == null || m.authorId !== currentUserId))
    .map((m) => m.id)
  if (unread.length === 0) return null
  return Math.min(...unread)
}

// 캐치업 자동 게이트용 미읽음 개수 — watermark 초과 + 미삭제 + 내가 작성하지 않은 메시지.
// firstUnreadMessageId 와 동일하게 내 메시지를 제외해야 진입 후 내 전송으로 유령 캐치업이 뜨지 않는다(#491).
export function unreadFromOthersCount(
  messages: { id: number; authorId?: number; deleted?: boolean }[],
  watermark: number | null,
  currentUserId?: number | null,
): number {
  if (watermark == null) return 0
  return messages.filter(
    (m) => m.id > watermark && !m.deleted && (currentUserId == null || m.authorId !== currentUserId),
  ).length
}
