// 프로젝트 탭 길 목록(WP-1477) — 하위 길로 구분되는 탭들. 이슈 탭도 `/projects/:key/issues` 로 고정 주소를 갖는다(WP-2085, 맨 `/projects/:key` 는 홈).
// 탭 정의(pages/projects/tabs/projectTabs.ts)의 주소 해석과 모바일 뒤로가기 판정(lib/mobile/routes.ts PROJECT_TAB·PROJECT_TAB_DETAIL)이
// 같은 목록을 따로 들고 있으면 탭을 더할 때 한쪽만 고쳐 어긋난다. lib 은 pages 를 import 하지 않으므로 목록을 여기에 둔다.

/** 하위 길로 구분되는 프로젝트 탭 — 표시 순서대로(이슈 목록은 이슈 상세 `/issues/:number` 와 달리 번호가 붙지 않는 `issues`). 노트는 `notes` 만 여기 두고, 페이지 id 가 붙는 `notes/<id>` 모양은 tabFromPath 가 따로 알아본다. 모바일 routes 는 이 목록으로 모든 탭의 `/<탭>/:id` 상세 규칙(PROJECT_TAB_DETAIL — 뒤로가기는 그 탭 목록)을 만든다(WP-2114). */
export const PROJECT_TAB_PATHS = ['overview', 'issues', 'notes', 'timeline', 'cycles', 'workflow', 'versions'] as const

/** 하위 길 탭 하나. */
export type ProjectTabPath = (typeof PROJECT_TAB_PATHS)[number]

/**
 * 프로젝트 이슈 목록 고정 주소(WP-2085) — `/projects/:key/issues[?쿼리]`.
 * 맨 `/projects/:key` 는 프로젝트 홈(마지막 탭 기억)이라 이슈 목록으로 가는 링크는 이 고정 주소를 써야 탭이 흔들리지 않는다.
 * query 는 `?` 없는 쿼리 문자열이며 비어 있으면 붙이지 않는다.
 */
export function projectIssuesPath(key: string, query?: string): string {
  return query ? `/projects/${key}/issues?${query}` : `/projects/${key}/issues`;
}
