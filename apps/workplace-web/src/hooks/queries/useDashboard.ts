import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { dashboardApi } from '../../api/dashboard'
import { dashboardKeys } from './dashboardKeys'

/** 대시보드 레이아웃 조회. */
export function useDashboardLayout() {
  return useQuery({ queryKey: dashboardKeys.layout(), queryFn: dashboardApi.get })
}

/** 레이아웃 저장 + 캐시 갱신. */
export function useSaveDashboardLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (widgets: string[]) => dashboardApi.save(widgets),
    onSuccess: (data) => qc.setQueryData(dashboardKeys.layout(), data),
  })
}
