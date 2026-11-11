import type { WikiSpace } from '@/types/wiki'

/** 노트 공간 선택 상자의 묶음 종류(WP-1480) — 개인 / 팀 / 프로젝트. */
export type WikiSpaceGroupKind = 'personal' | 'team' | 'project'

/** 선택 상자에 그릴 한 묶음 — 제목(label)과 그 아래 공간들. */
export interface WikiSpaceGroup {
  kind: WikiSpaceGroupKind
  label: string
  spaces: WikiSpace[]
}

/** 프로젝트 노트 공간인지 — 서버가 연결된 프로젝트 key 를 실어 준 공간(WP-1480). */
export function isProjectWikiSpace(space: Pick<WikiSpace, 'projectKey'> | null | undefined): boolean {
  return !!space?.projectKey
}

/**
 * 노트 사이드바 공간 선택 상자를 「개인 / 팀 / 프로젝트」 묶음으로 나눈다(WP-1480 A안).
 * - 프로젝트: projectKey 가 있는 공간 — 이름 순(한국어 정렬). 프로젝트가 많아도 찾기 쉽게.
 * - 팀: TEAM 이면서 projectKey 가 없는 공간, 개인: PERSONAL — 둘 다 서버가 준 순서를 그대로 둔다(지금 선택 상자와 같은 순서).
 * 비어 있는 묶음은 결과에서 빠진다 — 제목만 덩그러니 보이지 않게.
 */
export function groupWikiSpaces(spaces: readonly WikiSpace[]): WikiSpaceGroup[] {
  const personal: WikiSpace[] = []
  const team: WikiSpace[] = []
  const project: WikiSpace[] = []
  for (const s of spaces) {
    if (isProjectWikiSpace(s)) project.push(s)
    else if (s.type === 'PERSONAL') personal.push(s)
    else team.push(s)
  }
  project.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const groups: WikiSpaceGroup[] = [
    { kind: 'personal', label: '개인', spaces: personal },
    { kind: 'team', label: '팀', spaces: team },
    { kind: 'project', label: '프로젝트', spaces: project },
  ]
  return groups.filter((g) => g.spaces.length > 0)
}

/**
 * 프로젝트에 연결할 수 있는 기존 팀 공간 후보(WP-1480) — 내가 OWNER 인, 아직 어느 프로젝트에도 연결되지 않은 TEAM 공간.
 * 서버(ProjectNoteSpaceService.link)도 같은 조건으로 거절한다. 이름 순.
 */
export function linkableTeamSpaces(spaces: readonly WikiSpace[]): WikiSpace[] {
  return spaces
    .filter((s) => s.type === 'TEAM' && s.role === 'OWNER' && !isProjectWikiSpace(s))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
