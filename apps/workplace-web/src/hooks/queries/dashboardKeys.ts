import type { DashboardDevice } from '../../types/dashboard'

// 대시보드 쿼리키. all 프리픽스로 레이아웃 캐시 동시 무효화. 레이아웃은 기기별로 캐시를 나눈다(WP-142).
export const dashboardKeys = {
  all: ['dashboard'] as const,
  layout: (device: DashboardDevice) => [...dashboardKeys.all, 'layout', device] as const,
}
