// AI 사이드 패널 폭 범위 — 클램프·저장은 AIAssistantContext.resize(), 손잡이 접근성 범위(aria)는 AISidePanel 이 함께 쓴다(WP-892).
// 컴포넌트·컨텍스트 파일과 분리(react-refresh 규칙: 컴포넌트 파일은 컴포넌트만 export).
export const SIDE_MIN_WIDTH = 320
export const SIDE_MAX_WIDTH = 600
export const SIDE_DEFAULT_WIDTH = 380
