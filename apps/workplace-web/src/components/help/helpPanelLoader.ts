// 도움말 패널 본체 모듈 받기(WP-1505) — LazyHelpPanel 의 lazy 와 「?」 단추의 미리 받기가 같은 import 를 쓴다(같은 모듈이라 한 번만 받는다).
// 컴포넌트 파일과 분리(react-refresh 규칙: 컴포넌트 파일은 컴포넌트만 export).

/** 패널 본체 모듈 받기 — 「?」 단추에 마우스·포커스가 오면 미리 불러 여는 순간 스켈레톤이 짧게 끝나게 한다. */
export const preloadHelpPanel = () => import('./HelpPanel')
