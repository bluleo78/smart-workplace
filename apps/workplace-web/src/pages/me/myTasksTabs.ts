// 내 작업 탭 라벨 단일 출처 — 화면 탭(MyTasksPage)과 AI 화면 컨텍스트 builder 가 공유해
// 사용자와 AI 가 같은 단어로 말하게 한다. (컴포넌트 파일 밖에 둬 react-refresh 규칙 충족)
// 개요(WP-1484)가 맨 앞 — 개요 · 할당 · 내가 만든 · 구독.
export const MY_TASKS_TAB_LABEL = { overview: '개요', assigned: '할당', reported: '내가 만든', watched: '구독' } as const
