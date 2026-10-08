/**
 * 종료 안내(삭제됨·접근 불가)의 "노트 목록으로" 목적지(WP-296).
 * 노트의 스페이스가 아직 내 스페이스 목록에 있으면 그 목록으로 — /wiki 는 첫 스페이스(개인 노트)로 리다이렉트돼 엉뚱한 곳에 선다.
 * 목록에서 빠졌거나(멤버 제거로 접근 불가) 목록을 아직 모르면 /wiki — 열 수 없는 스페이스로 보내면 거기서 다시 막힌다.
 */
export function wikiListPath(spaceId: number, spaces: readonly { id: number }[] | undefined): string {
  return spaces?.some((s) => s.id === spaceId) ? `/wiki/spaces/${spaceId}` : '/wiki'
}
