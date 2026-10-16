// AI 위임 작업 에픽 묶음(WP-375 §5.4) — 서버가 묶음 단위로 정렬해 준 목록(같은 묶음은 연속)을 화면 묶음으로 바꾼다.
// 재정렬하지 않는다: 서버 순서대로 훑다가 aiGroup.size ≥ 2 인 묶음이 시작되면 머리를 넣고, 같은 묶음 행을 이어 붙인다.
// 페이지가 이어 붙어도 서버가 묶음을 연속으로 주므로 다음 페이지의 하위 행은 앞 묶음에 붙는다.
// WP-426: 같은 원칙으로 연속한 같은 프로젝트 행을 한 구간(ProjectRun)으로 나누는 splitByProject 를 함께 둔다.
import type { IssueResponse } from '@/types/issue'
import type { IssueTypeSummary } from '@/types/issueType'

/** 묶음 머리에 쓰는 에픽 요약 — 에픽 행이 있으면 그 행, 없으면 하위 행의 부모 참조에서. */
export interface EpicHead {
  projectKey: string
  number: number
  title: string
  type: IssueTypeSummary | null
  childCount: number
  childDoneCount: number
}

export type AiTaskEntry =
  | { kind: 'row'; issue: IssueResponse }
  | { kind: 'group'; key: string; epic: EpicHead; head: IssueResponse | null; children: IssueResponse[] }

type GroupEntry = Extract<AiTaskEntry, { kind: 'group' }>

/** 서버 순서를 유지한 채 행 목록을 단독 행/에픽 묶음 항목으로 바꾼다. */
export function groupAiTasks(items: IssueResponse[]): AiTaskEntry[] {
  const out: AiTaskEntry[] = []
  let cur: GroupEntry | null = null
  for (const it of items) {
    const g = it.aiGroup
    // 단독 행(묶음 없음·크기 1) — 머리 없이 그대로.
    if (!g || g.size < 2) {
      cur = null
      out.push({ kind: 'row', issue: it })
      continue
    }
    const key = `${it.projectKey}-${g.epicNumber}`
    const isHead = it.number === g.epicNumber
    // 새 묶음의 첫 행 — 머리 항목을 만든다(같은 묶음의 연속 행은 아래에서 이어 붙는다).
    if (!cur || cur.key !== key) {
      cur = {
        kind: 'group',
        key,
        head: null,
        children: [],
        epic: {
          projectKey: it.projectKey,
          number: g.epicNumber,
          title: isHead ? it.title : (it.parent?.title ?? ''),
          type: isHead ? (it.type ?? null) : (it.parent?.type ?? null),
          childCount: g.epicChildCount,
          childDoneCount: g.epicChildDoneCount,
        },
      }
      out.push(cur)
    }
    if (isHead) cur.head = it
    else cur.children.push(it)
  }
  return out
}

/** 프로젝트 구간(WP-426) — 서버가 프로젝트 단위로 정렬해 준 목록에서 같은 프로젝트가 연속한 행들. */
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
 * name/size 는 구간 첫 행의 aiProject 를 쓰고, 없으면(이름이 빈 문자열이어도) key / 구간 행 수로 대체한다.
 * 스크롤 중 보고가 들어와 정렬 키가 바뀌면 이미 받은 행이 다음 페이지에 다시 올 수 있다 — 같은 id 는 처음 것만 둔다
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
      if (last.items[0].aiProject == null) last.size++
    } else {
      runs.push({ key: it.projectKey, name: it.aiProject?.name || it.projectKey, size: it.aiProject?.size ?? 1, items: [it] })
    }
  }
  return runs
}
