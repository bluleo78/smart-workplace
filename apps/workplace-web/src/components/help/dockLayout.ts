// 오른쪽 도킹 배치 판정(WP-1505) — 데스크톱에서 도움말 패널과 AI 옆 패널이 함께 열렸을 때 한 칸에 위아래로 합칠지 고른다.
// 하나만 열렸거나 넓으면 각자 자기 칸(나란히)이다. 판정은 실측 본문 폭이 아니라 컨테이너 − 레일 − 패널 폭 계산이다 —
// 실측으로 하면 위아래로 바꾼 순간 본문이 넓어져 다시 나란히로 돌아가는 되먹임(깜빡임)이 생긴다(계획 「내가 정한 것」 1).

/** 나란히 둘 때 본문이 받아야 할 최소 폭(px) — 이보다 좁아지면 위아래로 합친다. */
export const HELP_STACK_MIN_MAIN = 640

/**
 * 도움말(위)·AI(아래)를 한 칸에 합칠지 — 둘 다 열렸고 나란히 두면 본문이 HELP_STACK_MIN_MAIN 보다 좁아질 때만 참.
 * @param a.containerWidth 앱 셸(data-ai-page-root) 폭
 * @param a.railWidth 앱 레일 폭(접힘 56 · 펼침 152)
 * @param a.aiSide AI 가 옆 패널(mode === 'side')로 열렸는가 — 전체 화면 AI 는 본문(main) 안이라 도킹과 무관하다
 */
export function isDockStacked(a: {
  containerWidth: number
  railWidth: number
  helpOpen: boolean
  helpWidth: number
  aiSide: boolean
  aiWidth: number
}): boolean {
  if (!a.helpOpen || !a.aiSide) return false
  return a.containerWidth - a.railWidth - a.helpWidth - a.aiWidth < HELP_STACK_MIN_MAIN
}
