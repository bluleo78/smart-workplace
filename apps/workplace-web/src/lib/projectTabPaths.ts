// 프로젝트 탭 길 목록(WP-1477) — 이슈 탭(/projects/:key) 말고 하위 길로 구분되는 탭들.
// 탭 정의(pages/projects/tabs/projectTabs.ts)의 주소 해석과 모바일 뒤로가기 판정(lib/mobile/routes.ts PROJECT_TAB)이
// 같은 목록을 따로 들고 있으면 탭을 더할 때 한쪽만 고쳐 어긋난다. lib 은 pages 를 import 하지 않으므로 목록을 여기에 둔다.

/** 하위 길로 구분되는 프로젝트 탭 — 표시 순서대로. 노트는 `notes` 만 여기 두고, 페이지 id 가 붙는 `notes/<id>` 모양은 tabFromPath·모바일 routes 가 따로 알아본다. */
export const PROJECT_TAB_PATHS = ['overview', 'notes', 'timeline', 'cycles', 'versions'] as const

/** 하위 길 탭 하나. */
export type ProjectTabPath = (typeof PROJECT_TAB_PATHS)[number]
