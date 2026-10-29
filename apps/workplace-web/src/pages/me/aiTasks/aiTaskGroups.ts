// AI 위임 작업 묶음(WP-375 §5.4, WP-1211) — 서버가 묶음 단위로 정렬해 준 목록(같은 묶음은 연속)을 화면 묶음으로 바꾼다.
// 재정렬하지 않는다: 서버 순서대로 훑다가 새 묶음이 시작되면 머리를 넣고, 같은 묶음 행을 이어 붙인다. 모든 행이 머리 줄 하나 아래에 놓인다 —
// 같은 프로젝트 에픽 묶음(하위가 1개여도)과 프로젝트마다 하나인 「에픽 없음」 묶음(aiGroup.epicNumber null).
// 페이지가 이어 붙어도 서버가 묶음을 연속으로 주므로 다음 페이지의 하위 행은 앞 묶음에 붙는다.
// 프로젝트 구간 나누기(splitByProject)는 내 작업과 함께 쓰려고 lib/projectRuns 로 옮겼다(WP-919).
import { epicTypeSummary } from '@/lib/epicColor'
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
  | { kind: 'noEpic'; key: string; projectKey: string; size: number; children: IssueResponse[] }

type GroupEntry = Extract<AiTaskEntry, { kind: 'group' | 'noEpic' }>

/** 서버 순서를 유지한 채 행 목록을 에픽 묶음/「에픽 없음」 묶음 항목으로 바꾼다. aiGroup 이 없는 행(이전 서버 응답)만 머리 없는 단독 행이다. */
export function groupAiTasks(items: IssueResponse[]): AiTaskEntry[] {
  const out: AiTaskEntry[] = []
  let cur: GroupEntry | null = null
  for (const it of items) {
    const g = it.aiGroup
    // 묶음 정보가 없는 행 — 머리 없이 그대로(묶음 정보를 싣기 전 서버와 섞여도 행을 잃지 않게).
    if (!g) {
      cur = null
      out.push({ kind: 'row', issue: it })
      continue
    }
    // 「에픽 없음」 묶음 — 프로젝트마다 하나. 머리는 건수(size, 필터 적용 후 전체)만 그린다.
    if (g.epicNumber == null) {
      const key = `${it.projectKey}-no-epic`
      if (!cur || cur.key !== key) {
        cur = { kind: 'noEpic', key, projectKey: it.projectKey, size: g.size, children: [] }
        out.push(cur)
      }
      cur.children.push(it)
      continue
    }
    const key = `${it.projectKey}-${g.epicNumber}`
    const isHead = it.number === g.epicNumber
    // 새 묶음의 첫 행 — 머리 항목을 만든다(같은 묶음의 연속 행은 아래에서 이어 붙는다).
    if (!cur || cur.key !== key || cur.kind !== 'group') {
      cur = {
        kind: 'group',
        key,
        head: null,
        children: [],
        epic: {
          projectKey: it.projectKey,
          number: g.epicNumber,
          title: isHead ? it.title : (it.parent?.title ?? ''),
          // 머리 아이콘 색 = 에픽 색(WP-1017) — 머리가 에픽 행이면 그 epicColor, 하위 행이면 서버가 부모 요약에 실은 에픽 색.
          type: isHead ? epicTypeSummary(it) : (it.parent?.type ?? null),
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
