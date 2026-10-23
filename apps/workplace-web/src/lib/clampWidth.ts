// 패널 폭 범위 맞추기 — 앱 목록(sidebarWidth)·AI 사이드 패널(AIAssistantContext)·공용 손잡이 훅(hooks/useResizeHandle)이 함께 쓴다(WP-892).

/** 폭을 min~max 로 맞춘다. max 가 min 보다 작으면(아주 좁은 화면) min. 정수 px 로 반올림. */
export function clampWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(min, max), Math.max(min, width)))
}
