// 노트 「최근」·「즐겨찾기」 목록이 함께 쓰는 제목 아래 경로 줄.

/** 제목 아래 줄 — 「공간 › 상위 › 부모」(루트 직속이면 공간 이름만). */
export function wikiPathLine({ spaceName, ancestorTitles }: { spaceName: string; ancestorTitles: string[] }): string {
  return [spaceName, ...ancestorTitles].join(' › ')
}
