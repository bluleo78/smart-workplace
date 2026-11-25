// 워크플로우 탭의 보기 값 — 화면 파일이 컴포넌트만 내보내도록(react-refresh) 순수 함수는 따로 둔다.
/** 워크플로우 탭의 보기 — 한 단 탭으로 고른다. */
export type WorkflowView = 'graph' | 'yaml' | 'runs' | 'versions'

/** 주소 `?view=` 값을 보기로 바꾼다 — 기본은 그래프, 예전 `editor` 와 모르는 값도 그래프로 연다(순수 함수). */
export function workflowViewFromParam(value: string | null): WorkflowView {
  return value === 'yaml' || value === 'runs' || value === 'versions' ? value : 'graph'
}

/**
 * 워크플로우 탭 주소(검색 파라미터) 조립 한 곳(WP-2091) — 보기 전환(setView)과 서랍 「최근 실행」 링크가 같은 규칙을 쓴다.
 * current 를 복사해 view·run 만 바꾼다(`?workflow=` 등 나머지는 지킨다 — 통째로 바꾸면 고른 워크플로우가 사라진다).
 * - view: 주어지면 `?view=` 를 쓴다. 실행(runs)이 아닌 보기로 가면 run·runsView 를 지운다(실행을 떠나면 그 상태도 버린다).
 * - run: 문자열이면 그 실행을 열고, null 이면 실행 선택을 푼다. 주어지면(바꾸면) 모아 보기(runsView)는 항상 지운다.
 */
export function workflowTabSearch(
  current: URLSearchParams,
  patch: { view?: string; run?: string | null },
): URLSearchParams {
  const params = new URLSearchParams(current)
  if (patch.view !== undefined) params.set('view', patch.view)
  if (patch.run !== undefined) {
    if (patch.run === null) params.delete('run')
    else params.set('run', patch.run)
    params.delete('runsView')
  }
  if (patch.view !== undefined && patch.view !== 'runs') {
    params.delete('run')
    params.delete('runsView')
  }
  return params
}
