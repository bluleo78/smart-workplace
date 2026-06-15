// 홈 대시보드 레이아웃 REST 호출. client(baseURL /api/v1) 사용.
import { client } from './client'
import type { DashboardLayout } from '../types/dashboard'

export const dashboardApi = {
  get: () => client.get<DashboardLayout>('/me/dashboard').then((r) => r.data),
  save: (widgets: string[]) =>
    client.put<DashboardLayout>('/me/dashboard', { widgets }).then((r) => r.data),
}
