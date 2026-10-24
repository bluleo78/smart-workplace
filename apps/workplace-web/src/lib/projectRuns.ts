// 프로젝트 구간(WP-426, WP-919) — 서버가 프로젝트 단위로 정렬해 준 목록을 화면의 프로젝트 구간으로 나눈다.
// AI 위임 작업과 내 작업(WP-915)이 함께 쓴다. 재정렬하지 않는다: 서버 순서대로 훑다가 프로젝트가 바뀌면 새 구간을 연다.
import type { IssueResponse } from '@/types/issue'

/** 프로젝트 구간 — 서버가 프로젝트 단위로 정렬해 준 목록에서 같은 프로젝트가 연속한 행들. */
export interface ProjectRun {
  key: string
  name: string
  /** 서버가 센 그 프로젝트의 전체 행 수 — 아직 불러오지 않은 행도 포함하므로 items.length 와 다를 수 있다. */
  size: number
  items: IssueResponse[]
}

/**
 * 서버 순서를 유지한 채 연속한 같은 projectKey 를 한 구간으로 나눈다(재정렬 금지).
 * 서버가 한 프로젝트 행을 페이지 경계 너머로도 연속으로 주므로, 이어 붙은 페이지의 행은 앞 구간에 합쳐진다.
 * name/size 는 구간 첫 행의 projectGroup(내 작업) → aiProject(AI 위임 작업) 순으로 읽고,
 * 둘 다 없으면(이름이 빈 문자열이어도) key / 구간 행 수로 대체한다.
 * 스크롤 중 정렬 키가 바뀌면 이미 받은 행이 다음 페이지에 다시 올 수 있다 — 같은 id 는 처음 것만 둔다
 * (같은 머리 줄·행이 두 번 그려지거나 React key 가 겹치지 않게).
 */
export function splitByProject(items: IssueResponse[]): ProjectRun[] {
  const runs: ProjectRun[] = []
  const seen = new Set<number>()
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    const last = runs[runs.length - 1]
    if (last && last.key === it.projectKey) {
      last.items.push(it)
      // 서버 건수가 없으면 구간 행 수로 센다.
      if (projectInfo(last.items[0]) == null) last.size++
    } else {
      const info = projectInfo(it)
      runs.push({ key: it.projectKey, name: info?.name || it.projectKey, size: info?.size ?? 1, items: [it] })
    }
  }
  return runs
}

/** 행에 실린 프로젝트 이름·건수 — 내 작업 묶음(projectGroup)을 AI 위임 작업(aiProject)보다 먼저 본다. */
function projectInfo(it: IssueResponse) {
  return it.projectGroup ?? it.aiProject
}
