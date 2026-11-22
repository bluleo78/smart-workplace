import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { dashboardApi } from '../../api/dashboard'
import { handleApiError, isConflictError } from '../../lib/api-error'
import type { DashboardDevice, DashboardLayout, DashboardWidgetConfig } from '../../types/dashboard'
import { dashboardKeys } from './dashboardKeys'

/**
 * 기기별 대시보드 레이아웃 조회 — 쿼리 키에 device 를 넣어 모바일·데스크톱 캐시를 분리한다(WP-142).
 * 창 포커스 때 다시 불러와 다른 기기·탭의 변경을 따라잡는다(WP-1953 — 낡은 version 으로 저장해 409 를 맞는 일을 줄임).
 * 단, 저장(편집 저장·접기)이 진행 중이면 건너뛴다 — PUT 이전 위젯·version 으로 캐시가 되돌아가 뒤 PUT 이 409 를 맞지 않게.
 */
export function useDashboardLayout(device: DashboardDevice) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: dashboardKeys.layout(device),
    queryFn: () => dashboardApi.get(device),
    // dashboardKeys.all 접두로 저장·접기 mutation 을 모두 센다.
    refetchOnWindowFocus: () => qc.isMutating({ mutationKey: dashboardKeys.all }) === 0,
  })
}

/**
 * 저장 변수 — 어느 기기 레이아웃인지 함께 넘긴다. 편집을 시작한 기기로 저장해야 하므로(편집 중 화면 폭이 바뀌어도)
 * 렌더 시점의 device 로 훅을 고정하지 않는다.
 */
interface SaveDashboardVars {
  device: DashboardDevice
  widgets: DashboardWidgetConfig[]
  /** 편집을 시작할 때 읽은 레이아웃 version — 서버가 현재 값과 견줘 다르면 409(WP-1953). */
  version?: number
}

// 편집 저장 mutation 식별 키 — 진행 여부를 컴포넌트 수명과 무관하게 본다(useIsDashboardSaving).
const SAVE_MUTATION_KEY = [...dashboardKeys.all, 'save'] as const

/** 레이아웃 저장 + 해당 기기 캐시 갱신. */
export function useSaveDashboardLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: SAVE_MUTATION_KEY,
    mutationFn: ({ device, widgets, version }: SaveDashboardVars) => dashboardApi.save(device, widgets, version),
    // 저장 시작 시점에 이미 날아가던 GET(직전 포커스 재조회 등)을 취소한다 — 그 응답이 PUT 의 onSuccess 뒤에 도착해
    // 더 오래된 위젯·version 으로 캐시를 덮는 일을 막는다. 저장 중 새로 시작되는 재조회는 refetchOnWindowFocus 가드가 막는다.
    onMutate: async ({ device }) => {
      await qc.cancelQueries({ queryKey: dashboardKeys.layout(device) })
    },
    onSuccess: (data, { device }) => qc.setQueryData(dashboardKeys.layout(device), data),
    // 409 = 다른 곳에서 먼저 저장됨 — 최신 레이아웃을 다시 불러온다. 편집을 끝내고 문구를 보이는 일은 호출부(saveEdit)가 한다.
    onError: (err, { device }) => {
      if (isConflictError(err)) void qc.invalidateQueries({ queryKey: dashboardKeys.layout(device) })
    },
  })
}

/** 접기 토글 변수 — 어느 위젯을 접을지/펼칠지. */
interface ToggleCollapsedVars {
  id: string
  collapsed: boolean
}

// 접기 토글 mutation 식별 키 — 진행 중 개수로 "마지막 토글"을 판별해 그때만 재조회한다.
const COLLAPSE_MUTATION_KEY = [...dashboardKeys.all, 'collapse'] as const

// 위젯별 "마지막 토글" 순번 — 실패한 토글은 자신이 그 위젯의 마지막 토글일 때만 롤백한다. 모듈 수준에 두는 이유:
// 대기 중인 mutation 은 컴포넌트가 다시 마운트돼도 살아 있으므로 순번도 컴포넌트 수명과 무관해야 한다.
// 마지막 토글이 끝나면(onSettled) 항목을 지워 위젯 id 가 바뀌어 가며 맵이 끝없이 자라지 않게 한다.
let collapseSeq = 0
const latestCollapseSeq = new Map<string, number>()

/** 레이아웃 캐시에서 한 위젯의 collapsed 만 바꾼다(없으면 그대로). */
function patchCollapsed(layout: DashboardLayout | undefined, id: string, collapsed: boolean) {
  if (!layout) return layout
  return { ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, collapsed } : w)) }
}

/**
 * 모바일 본문형 위젯 ⌃/⌄ 즉시 저장(WP-142). 낙관적으로 캐시를 먼저 바꾸고 모바일 레이아웃 전체를 PUT 한다.
 *
 * - 같은 scope 는 직렬 실행: 빠른 연타의 PUT 이 서로 추월해 이전 상태가 마지막에 저장되는 일을 막는다.
 * - PUT 본문은 실행 시점 캐시(앞선 토글·롤백이 모두 반영된 최신 낙관 상태)에서 만든다.
 * - 중간 토글의 성공 응답으로는 캐시를 덮지 않는다: 늦게 온 앞 응답이 뒤 토글의 낙관 상태를 되돌리는 깜빡임을 막는다.
 *   마지막 토글이 끝났을 때만 서버 상태와 맞춘다 — 성공이면 그 PUT 응답(=저장된 최신 레이아웃)을 캐시에 넣어 재조회(GET)를
 *   아끼고, 실패면 무엇이 저장됐는지 모르므로 재조회한다(그 사이 창 포커스 재조회는 onMutate 의 cancel 로 막힘).
 * - 연속 PUT 은 version 을 이어 보낸다(WP-1953): 각 PUT 은 실행 시점 캐시의 version 을 싣고, 성공하면 서버가 올린 version 을
 *   캐시에 반영한다(위젯은 그대로 — 위 낙관 상태 보호). 안 그러면 두 번째 PUT 이 낡은 version 으로 409 를 맞는다.
 *   409(다른 곳에서 바뀜)는 일반 실패와 같은 경로 — 롤백·(마지막이면)재조회 — 에 서버 문구 토스트가 나간다.
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
    mutationFn: () => {
      const cur = qc.getQueryData<DashboardLayout>(key)
      return dashboardApi.save('mobile', cur?.widgets ?? [], cur?.version)
    },
    onSuccess: (data) => {
      // 마지막 토글이 아니어도 version 만 서버 값으로 올린다 — 위젯은 뒤 토글의 낙관 상태라 응답으로 덮지 않는다.
      qc.setQueryData<DashboardLayout>(key, (old) => (old ? { ...old, version: data.version } : old))
    },
    onError: (err, { id, collapsed }, ctx) => {
      // 이 위젯의 마지막 토글일 때만 이전 값으로 되돌린다(뒤에 누른 탭을 덮어쓰지 않게).
      if (ctx && latestCollapseSeq.get(id) === ctx.seq) {
        qc.setQueryData<DashboardLayout>(key, (old) => patchCollapsed(old, id, !collapsed))
      }
      // 409 는 뒤에 대기 중인 PUT 도 같은 낡은 version 이라 줄줄이 409 가 난다 — 같은 문구가 연달아 뜨지 않게 마지막 것에서만
      // 알린다(그때 onSettled 가 재조회해 "최신을 불러왔다"는 서버 문구도 사실이 된다). 그 밖의 오류는 매번 알린다.
      if (isConflictError(err) && qc.isMutating({ mutationKey: COLLAPSE_MUTATION_KEY }) > 1) return
      handleApiError(err, '위젯 접기 상태를 저장하지 못했습니다')
    },
    onSettled: (data, err, { id }, ctx) => {
      // 이 위젯의 마지막 토글이면 순번 항목 정리(onError 의 롤백 판정이 끝난 뒤라 안전).
      if (ctx && latestCollapseSeq.get(id) === ctx.seq) latestCollapseSeq.delete(id)
      // 이 토글이 진행 중인 마지막 토글일 때만(=자기 자신 1건) 서버 상태와 맞춘다.
      if (qc.isMutating({ mutationKey: COLLAPSE_MUTATION_KEY }) === 1) {
        if (!err && data) {
          qc.setQueryData(key, data)
          return
        }
        return qc.invalidateQueries({ queryKey: key })
      }
    },
  })
}

/**
 * 접기 저장(대기 포함)이 진행 중인지. 편집 진입을 막는 데 쓴다 — 접기 PUT 은 편집 전 캐시로 레이아웃 전체를 보내므로
 * 편집 저장 뒤에 도착하면 편집 결과를 덮어쓰고, 그 뒤 재조회가 편집 전 레이아웃을 보여 준다(WP-142).
 */
export function useIsCollapseSaving() {
  return useIsMutating({ mutationKey: COLLAPSE_MUTATION_KEY }) > 0
}

/** 편집 저장(PUT) 진행 중 여부 — 저장 중 Dashboard 가 재마운트돼도(lg 경계 리사이즈) 이어서 본다(WP-162). */
export function useIsDashboardSaving() {
  return useIsMutating({ mutationKey: SAVE_MUTATION_KEY }) > 0
}
