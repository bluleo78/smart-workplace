// 홈 대시보드 편집 초안 저장소(WP-162) — 편집 시작 기기·초안·undo 스냅샷을 Dashboard 바깥(AppLayout 의 셸 분기 위)에 둔다.
// 편집 중 창 폭이 lg(1024px) 경계를 넘으면 AppLayout 이 셸(MobileShell ↔ 데스크톱 레일)을 갈아 끼우며 Dashboard 가
// 다시 마운트된다. 초안을 Dashboard 의 로컬 state 로 두면 그때 버려지므로, 셸 교체에도 살아 있는 이 provider 로 올린다.
// 다른 기기 폭에서는 editing(= 시작 기기 === 현재 기기)이 false 라 초안이 보이지도 저장되지도 않고, 원래 폭으로 돌아오면 복원된다.
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { useAuth } from '@/hooks/useAuth'
import type { DashboardDevice, DashboardWidgetConfig } from '@/types/dashboard'

/** 편집 초안 상태 — 셸 교체(재마운트)를 넘어 유지해야 하는 값만. 모달·강조·공지 같은 일시 상태는 Dashboard 로컬. */
export interface DashboardEditDraftState {
  /** 편집을 시작한 기기(null = 편집 아님). */
  editDevice: DashboardDevice | null
  /** 저장 전 로컬 초안. */
  draft: DashboardWidgetConfig[]
  /** 단일 레벨 undo 스냅샷(null = 되돌릴 것 없음). */
  undoSnapshot: DashboardWidgetConfig[] | null
  /**
   * 편집 세션 번호(0 = 편집 시작 전) — 저장 완료는 자기 세션일 때만 편집을 끝낸다. 저장 중 lg 경계를 넘어 다른 기기
   * 폭에서 새 편집을 시작하면, 늦게 끝난 이전 저장이 그 새 편집을 닫아 버리지 않게 한다.
   */
  session: number
}

const EMPTY_EDIT_DRAFT: DashboardEditDraftState = { editDevice: null, draft: [], undoSnapshot: null, session: 0 }

type DraftStore = [DashboardEditDraftState, Dispatch<SetStateAction<DashboardEditDraftState>>]

const DashboardEditDraftContext = createContext<DraftStore | null>(null)

/**
 * 편집 초안 provider. AppLayout 이 셸 분기 바깥에서 감싼다.
 *
 * 초안은 "누구의(사용자·테넌트) 것인지" 주인 키와 함께 저장하고, 주인이 바뀌면 빈 상태로 본다 — 로그아웃 후 다른 계정
 * 로그인이나 테넌트 전환 때 이전 초안이 새 세션 홈에 새지 않게 한다(테넌트 전환은 전체 리로드라 원래도 비지만 이중 안전장치).
 */
export function DashboardEditDraftProvider({ children }: { children: ReactNode }) {
  const { user, activeTenant } = useAuth()
  const owner = `${user?.id ?? ''}:${activeTenant?.tenantId ?? ''}`
  const [stored, setStored] = useState<{ owner: string; state: DashboardEditDraftState }>({
    owner,
    state: EMPTY_EDIT_DRAFT,
  })
  const state = stored.owner === owner ? stored.state : EMPTY_EDIT_DRAFT

  // 갱신은 항상 현재 주인 기준 — 주인이 바뀐 뒤 첫 갱신은 이전 주인의 초안이 아니라 빈 상태에서 출발한다.
  const setState = useCallback<Dispatch<SetStateAction<DashboardEditDraftState>>>(
    (action) =>
      setStored((prev) => {
        const base = prev.owner === owner ? prev.state : EMPTY_EDIT_DRAFT
        return { owner, state: typeof action === 'function' ? action(base) : action }
      }),
    [owner],
  )

  const value = useMemo<DraftStore>(() => [state, setState], [state, setState])
  return <DashboardEditDraftContext.Provider value={value}>{children}</DashboardEditDraftContext.Provider>
}

/**
 * 편집 초안 상태 훅 — provider 안이면 셸 교체에도 유지되는 저장소를, 밖이면(단독 렌더 등) 컴포넌트 로컬 state 를 쓴다.
 * 로컬 폴백은 재마운트 시 초안이 사라지는 WP-162 이전 동작과 같다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardEditDraftStore(): DraftStore {
  const shared = useContext(DashboardEditDraftContext)
  const local = useState<DashboardEditDraftState>(EMPTY_EDIT_DRAFT)
  return shared ?? local
}
