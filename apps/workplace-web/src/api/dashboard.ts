// 홈 대시보드 레이아웃 REST 호출. client(baseURL /api/v1) 사용.
import type { DashboardDevice, DashboardLayout, DashboardWidgetConfig } from '../types/dashboard'
import { client } from './client'

// 기기 쿼리 — 모바일만 ?device=mobile 을 붙인다. 데스크톱은 서버 기본값(desktop)에 맡겨 요청 형태를 예전과 같게 유지한다
// (기존 클라이언트·e2e 문자열 glob 목('**/api/v1/me/dashboard')이 쿼리 문자열 때문에 빗나가지 않게, WP-142).
const deviceParams = (device: DashboardDevice) => (device === 'mobile' ? { device } : undefined)

export const dashboardApi = {
  get: (device: DashboardDevice) =>
    client
      .get<DashboardLayout>('/me/dashboard', { params: deviceParams(device) })
      .then((r) => r.data),
  // 객체-배열 컨트랙트: PUT body 는 { widgets: [{type,count,hidden,...}, ...] }. 기기별 전체 교체.
  save: (device: DashboardDevice, widgets: DashboardWidgetConfig[]) =>
    client
      .put<DashboardLayout>('/me/dashboard', { widgets }, { params: deviceParams(device) })
      .then((r) => r.data),
}
