import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { dashboardApi } from '../../api/dashboard'
import { handleApiError } from '../../lib/api-error'
import type { DashboardDevice, DashboardLayout, DashboardWidgetConfig } from '../../types/dashboard'
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

/** 접기 토글 변수 — 어느 위젯을 접을지/펼칠지. */
export interface ToggleCollapsedVars {
  id: string
  collapsed: boolean
}

// 접기 토글 mutation 식별 키 — 진행 중 개수로 "마지막 토글"을 판별해 그때만 재조회한다.
const COLLAPSE_MUTATION_KEY = [...dashboardKeys.all, 'collapse'] as const

// 위젯별 "마지막 토글" 순번 — 실패한 토글은 자신이 그 위젯의 마지막 토글일 때만 롤백한다. 모듈 수준에 두는 이유:
// 대기 중인 mutation 은 컴포넌트가 다시 마운트돼도 살아 있으므로 순번도 컴포넌트 수명과 무관해야 한다.
let collapseSeq = 0
const latestCollapseSeq = new Map<string, number>()

/** 레이아웃 캐시에서 한 위젯의 collapsed 만 바꾼다(없으면 그대로). */
function patchCollapsed(layout: DashboardLayout | undefined, id: string, collapsed: boolean) {
  if (!layout) return layout
  return { widgets: layout.widgets.map((w) => (w.id === id ? { ...w, collapsed } : w)) }
}

/**
 * 모바일 본문형 위젯 ⌃/⌄ 즉시 저장(WP-142). 낙관적으로 캐시를 먼저 바꾸고 모바일 레이아웃 전체를 PUT 한다.
 *
 * - 같은 scope 는 직렬 실행: 빠른 연타의 PUT 이 서로 추월해 이전 상태가 마지막에 저장되는 일을 막는다.
 * - PUT 본문은 실행 시점 캐시(앞선 토글·롤백이 모두 반영된 최신 낙관 상태)에서 만든다.
 * - 성공 응답으로 캐시를 덮지 않는다: 늦게 온 앞 응답이 뒤 토글의 낙관 상태를 되돌리는 깜빡임을 막는다.
 *   대신 마지막 토글이 끝났을 때만 재조회해 서버 상태와 맞춘다(그 사이 창 포커스 재조회는 onMutate 의 cancel 로 막힘).
 * - 실패하면 그 위젯만 이전 값으로 되돌리고 토스트. 단, 같은 위젯을 그 뒤에 또 눌렀다면 롤백하지 않는다 —
 *   뒤 탭의 낙관 상태가 사용자의 마지막 의도이고, 뒤 PUT 이 그 상태(실행 시점 캐시)를 저장한다.
 *   토스트는 mutate 개별 콜백이 아닌 여기 둔다 —
 *   TanStack v5 의 mutate 개별 콜백은 마지막 호출에만 불려 연타 중 앞선 실패가 묻힌다.
 */
export function useToggleWidgetCollapsed() {
  const qc = useQueryClient()
  const key = dashboardKeys.layout('mobile')
  return useMutation<DashboardLayout, unknown, ToggleCollapsedVars, { seq: number }>({
    mutationKey: COLLAPSE_MUTATION_KEY,
    scope: { id: 'dashboard-collapse-mobile' },
    onMutate: async ({ id, collapsed }) => {
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<DashboardLayout>(key, (old) => patchCollapsed(old, id, collapsed))
      const seq = ++collapseSeq
      latestCollapseSeq.set(id, seq)
      return { seq }
    },
    mutationFn: () => dashboardApi.save('mobile', qc.getQueryData<DashboardLayout>(key)?.widgets ?? []),
    onError: (err, { id, collapsed }, ctx) => {
      // 이 위젯의 마지막 토글일 때만 이전 값으로 되돌린다(뒤에 누른 탭을 덮어쓰지 않게).
      if (ctx && latestCollapseSeq.get(id) === ctx.seq) {
        qc.setQueryData<DashboardLayout>(key, (old) => patchCollapsed(old, id, !collapsed))
      }
      handleApiError(err, '위젯 접기 상태를 저장하지 못했습니다')
    },
    onSettled: () => {
      // 이 토글이 진행 중인 마지막 토글일 때만(=자기 자신 1건) 재조회.
      if (qc.isMutating({ mutationKey: COLLAPSE_MUTATION_KEY }) === 1) {
        return qc.invalidateQueries({ queryKey: key })
      }
    },
  })
}
