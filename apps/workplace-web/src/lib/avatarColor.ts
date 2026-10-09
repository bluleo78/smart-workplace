// 아바타 이니셜 — 이미지 URL 이 없으므로 이름 이니셜로 표시한다.
// 색은 사람 색 토큰(--presence-1..8) 하나만 쓴다(WP-318): 요소에 `bg-presence text-presence-foreground` 리터럴 클래스 +
// `presenceStyle(userId)`(lib/collab/presence) — 노트 접속자 아바타(WikiPresence)와 같은 API 라 같은 사람은 어디서나 같은 색이다.

/** 이름의 첫 글자(영문은 대문자). 비면 '?'. */
export function avatarInitials(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  const first = [...trimmed][0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}
