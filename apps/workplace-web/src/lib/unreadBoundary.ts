// 미읽음 경계 판정 — "진입 전부터 있던, 남이 보낸, 아직 안 읽은" 메시지만 미읽음으로 본다.
// 세 조건으로 좁힌다:
//   1) watermark < id        — 마지막으로 읽은 지점보다 뒤(미읽음 후보)
//   2) id <= ceiling         — 진입 시점 최대 id 이하. 진입 후 도착한 라이브 메시지(내 전송·AI 답글·남의 신규)는
//                              내가 그 자리에서 보고 있으므로 미읽음/캐치업 대상이 아니다(#491).
//   3) authorId !== me       — 내가 보낸 메시지는 제외(#491. ceiling 이 라이브 케이스를 이미 막지만,
//                              진입 시점에 남아있던 내 미읽음 메시지까지 방어).
// 진입-고정 watermark 는 내 활동(전송·읽음)으로 갱신되지 않아, 위 제한 없이는 진입 후 발생한 모든 메시지가
// 미읽음으로 잡혀 유령 "여기까지 읽음" 구분선 + 캐치업 카드가 부활한다.
// currentUserId / ceiling 미지정 시 해당 조건을 건너뛴다(하위호환).
function isUnreadBacklog(
  m: { id: number; authorId?: number; deleted?: boolean },
  watermark: number,
  currentUserId?: number | null,
  ceiling?: number | null,
): boolean {
  if (m.id <= watermark) return false
  if (ceiling != null && m.id > ceiling) return false
  if (currentUserId != null && m.authorId === currentUserId) return false
  return true
}

// 첫 미읽음 메시지 id — 이 값 앞에 "여기까지 읽음" 구분선을 그리고, 진입 시 그 위치로 스크롤한다.
// 위에 읽은 메시지가 있어야(중간 경계) 구분선을 표시한다.
export function firstUnreadMessageId(
  messages: { id: number; authorId?: number }[],
  watermark: number | null,
  currentUserId?: number | null,
  ceiling?: number | null,
): number | null {
  if (watermark == null) return null
  const ids = messages.map((m) => m.id)
  // 위에 읽은 메시지가 없으면(전부 미읽음) 경계가 아니라 "채널 시작" → 구분선 없음.
  if (!ids.some((id) => id <= watermark)) return null
  const unread = messages
    .filter((m) => isUnreadBacklog(m, watermark, currentUserId, ceiling))
    .map((m) => m.id)
  if (unread.length === 0) return null
  return Math.min(...unread)
}

// 캐치업 자동 게이트용 미읽음 개수 — 미삭제 + 위 isUnreadBacklog 조건을 만족하는 메시지 수.
export function unreadFromOthersCount(
  messages: { id: number; authorId?: number; deleted?: boolean }[],
  watermark: number | null,
  currentUserId?: number | null,
  ceiling?: number | null,
): number {
  if (watermark == null) return 0
  return messages.filter((m) => !m.deleted && isUnreadBacklog(m, watermark, currentUserId, ceiling))
    .length
}
