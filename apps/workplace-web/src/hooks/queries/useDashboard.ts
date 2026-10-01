import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { dashboardApi } from '../../api/dashboard'
import type { DashboardDevice, DashboardWidgetConfig } from '../../types/dashboard'
import { dashboardKeys } from './dashboardKeys'

/** 기기별 대시보드 레이아웃 조회 — 쿼리 키에 device 를 넣어 모바일·데스크톱 캐시를 분리한다(WP-142). */
export function useDashboardLayout(device: DashboardDevice) {
  return useQuery({ queryKey: dashboardKeys.layout(device), queryFn: () => dashboardApi.get(device) })
}

/**
 * 저장 변수 — 어느 기기 레이아웃인지 함께 넘긴다. 편집을 시작한 기기로 저장해야 하므로(편집 중 화면 폭이 바뀌어도)
 * 렌더 시점의 device 로 훅을 고정하지 않는다.
 */
export interface SaveDashboardVars {
  device: DashboardDevice
  widgets: DashboardWidgetConfig[]
}

/** 레이아웃 저장 + 해당 기기 캐시 갱신. */
export function useSaveDashboardLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ device, widgets }: SaveDashboardVars) => dashboardApi.save(device, widgets),
    onSuccess: (data, { device }) => qc.setQueryData(dashboardKeys.layout(device), data),
  })
}
