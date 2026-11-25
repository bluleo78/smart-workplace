// 워크플로우 탭의 보기 값 — 화면 파일이 컴포넌트만 내보내도록(react-refresh) 순수 함수는 따로 둔다.
/** 워크플로우 탭의 보기 — 한 단 탭으로 고른다. */
export type WorkflowView = 'graph' | 'yaml' | 'runs' | 'versions'

/** 주소 `?view=` 값을 보기로 바꾼다 — 기본은 그래프, 예전 `editor` 와 모르는 값도 그래프로 연다(순수 함수). */
export function workflowViewFromParam(value: string | null): WorkflowView {
  return value === 'yaml' || value === 'runs' || value === 'versions' ? value : 'graph'
}
