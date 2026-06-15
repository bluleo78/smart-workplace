// 대시보드 쿼리키. all 프리픽스로 레이아웃 캐시 동시 무효화.
export const dashboardKeys = {
  all: ['dashboard'] as const,
  layout: () => [...dashboardKeys.all, 'layout'] as const,
}
