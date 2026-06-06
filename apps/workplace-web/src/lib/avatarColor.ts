// 아바타 이니셜/색상 — 이미지 URL 이 없으므로 이름 이니셜 + userId 기반 결정적 배경색으로 표시한다.
// 색은 사용자별로 일관되어야 식별 신호가 되므로 userId 해시로 팔레트에서 고정 선택한다.

/** 이름의 첫 글자(영문은 대문자). 비면 '?'. */
export function avatarInitials(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  const first = [...trimmed][0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

// Tailwind safelist 에 잡히도록 정적 문자열 배열로 둔다(동적 클래스 생성 금지).
const PALETTE = [
  'bg-red-500 text-white',
  'bg-orange-500 text-white',
  'bg-amber-500 text-white',
  'bg-green-500 text-white',
  'bg-teal-500 text-white',
  'bg-blue-500 text-white',
  'bg-indigo-500 text-white',
  'bg-purple-500 text-white',
  'bg-pink-500 text-white',
] as const

/** userId → 팔레트 내 결정적 색 클래스. */
export function avatarColorClass(userId: number): string {
  const idx = Math.abs(Math.trunc(userId)) % PALETTE.length
  return PALETTE[idx]
}
