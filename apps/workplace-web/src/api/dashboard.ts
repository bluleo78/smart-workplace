// 홈 대시보드 레이아웃 REST 호출. client(baseURL /api/v1) 사용.
import type { DashboardLayout, DashboardWidgetConfig } from '../types/dashboard'
import { client } from './client'

export const dashboardApi = {
  get: () => client.get<DashboardLayout>('/me/dashboard').then((r) => r.data),
  // 객체-배열 컨트랙트: PUT body 는 { widgets: [{type,count,hidden}, ...] }.
  save: (widgets: DashboardWidgetConfig[]) =>
    client.put<DashboardLayout>('/me/dashboard', { widgets }).then((r) => r.data),
}
