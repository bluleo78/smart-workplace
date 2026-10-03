// 저장된 뷰 상태 훅 — 데스크톱 ViewChipBar 와 모바일 뷰 칩 행이 공유한다.
// 현재 URL 쿼리와 저장 뷰의 일치·dirty 판정, 칩 적용/뷰 업데이트 동작을 담당한다.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useSavedViews, useUpdateSavedView } from '../../../hooks/queries/useSavedViews'
import { useIssueGroupBy } from '../../../hooks/useIssueGroupBy'
import { filtersToParams, parseFilters, parseView } from '../../../lib/issueFilters'
import {
  normalizeIssueQueryIgnoringViewAndGroup,
  queriesEqualIgnoringView,
  savedViewQueryToParams,
} from '../../../lib/savedViewQuery'
import type { SavedViewResponse } from '../../../types/savedView'

export interface SavedViewState {
  views: SavedViewResponse[]
  currentQuery: string
  isAllActive: boolean
  hasNothingToSave: boolean
  activeView: SavedViewResponse | null
  isViewDirty: boolean
  isViewActive: (v: SavedViewResponse) => boolean // !isAllActive && queriesEqualIgnoringView
  applyAll: () => void
  apply: (query: string) => void
  updateActiveView: (v: SavedViewResponse) => void // SHARED 면 확인 대상 설정
  updateConfirmTarget: SavedViewResponse | null
  setUpdateConfirmTarget: (v: SavedViewResponse | null) => void
  confirmUpdate: () => void
}

export function useSavedViewState(projectKey: string): SavedViewState {
  const [params, setParams] = useSearchParams()
  const viewsQuery = useSavedViews(projectKey)
  const update = useUpdateSavedView(projectKey)
  // 필터 갱신(#777) — "마지막으로 선택된 뷰" id. 칩 클릭/생성 직후엔 쿼리 내용으로 자동
  // 동기화되지만, 이후 사용자가 필터를 바꿔 더 이상 어떤 뷰의 쿼리와도 일치하지 않게 되어도
  // (dirty 상태) 이 값은 유지되어야 "뷰 업데이트" 대상이 누구인지 알 수 있다.
  const [selectedViewId, setSelectedViewId] = useState<number | null>(null)
  // matchingSignature 변화 감지용 — 렌더 중 setState 패턴에서 무한루프 방지.
  const [prevMatchingSignature, setPrevMatchingSignature] = useState<number | null | undefined>(undefined)
  // 업데이트 확인 대화상자 대상 뷰(SHARED 뷰만) — null 이면 닫힘.
  const [updateConfirmTarget, setUpdateConfirmTarget] = useState<SavedViewResponse | null>(null)

  // 실제 적용 중인 그룹 — URL 에 group 이 없으면 사이클 유무로 정해지는 기본값(#878).
  // pending(사이클 목록 로딩 중)엔 유효 그룹을 아직 모르므로 저장 뷰 매칭·dirty 판정을 보류한다(아래).
  const { raw: groupParam, groupBy, pending: groupPending } = useIssueGroupBy(projectKey, true)
  // 현재 URL 필터를 canonical 쿼리스트링으로 — 저장 뷰 페이로드(뷰 저장/수정 다이얼로그)에 사용.
  // group 도 포함해야 그룹이 저장 뷰에 영속된다 (#58). view(list/board) 도 그대로 저장.
  // group 은 항상 명시한다(없음='none') — 저장 뷰의 group 부재는 '그룹 없음'으로 해석되므로(#878), 기본(사이클) 그룹으로
  // 보던 화면을 저장하면 'cycle' 이 기록돼야 다시 열었을 때 같은 화면이 된다.
  const currentQuery = filtersToParams(parseFilters(params), parseView(params), groupParam ?? groupBy ?? 'none').toString()
  // "전체" 칩 활성 판정은 view·group 을 모두 제외하고 비교한다 (#599, #773) — 리스트/보드
  // 전환이나 그룹 변경이 우연히 저장뷰의 쿼리와 일치해 전체 대신 그 저장뷰가 활성으로 보이거나,
  // 반대로 필터가 전혀 없는데도 그룹만 바꿨다는 이유로 전체 칩이 비활성으로 보이는 것을 방지.
  // group 은 필터가 아니라 표시 옵션이라 "필터 없음" 여부와는 무관해야 한다.
  const isAllActive = normalizeIssueQueryIgnoringViewAndGroup(currentQuery) === ''
  // "뷰 저장" 버튼 비활성 판정은 기존대로 group 을 포함해 본다 — group 만 설정된 상태도
  // 저장할 가치가 있는 뷰이기 때문(#58 그룹 영속 테스트). 단 group 은 URL 원값 기준 — 명시하지 않은 기본 그룹은
  // 필터 없는 초기 화면과 같아 저장할 것이 없다. isAllActive(칩 강조용)와는 목적이 달라 별도 변수로 분리한다.
  const hasNothingToSave = isAllActive && groupParam == null

  // 현재 쿼리 내용과 일치하는 저장 뷰(있다면) — 칩 클릭/생성 직후 selectedViewId 동기화에 사용.
  // 기본 그룹 판정 보류 중엔 매칭하지 않는다 — 임시 그룹으로 잘못 매칭된 뷰가 selectedViewId 에 남으면,
  // 판정이 끝난 뒤 불일치(dirty)로 보여 「뷰 업데이트」가 뜬다.
  const matchingView = !isAllActive && !groupPending
    ? (viewsQuery.data ?? []).find((v) => queriesEqualIgnoringView(currentQuery, v.query))
    : undefined
  // #777: 필터가 활성 뷰의 쿼리와 일치하는 동안에는 selectedViewId 를 그 뷰로 유지/동기화하고,
  // "전체" 로 돌아가면 초기화한다. 필터만 바뀌어 더 이상 일치하지 않는 경우(dirty)는 그대로 유지해
  // "뷰 업데이트" 대상을 잃지 않는다. 렌더 중 조건부 setState(React 권장 패턴)로 처리해
  // 불필요한 effect 왕복 렌더를 피한다 — matchingSignature 로 실제 변화가 있을 때만 반영.
  let matchingSignature: number | null | undefined
  if (groupPending) matchingSignature = undefined
  else if (matchingView) matchingSignature = matchingView.id
  else if (isAllActive) matchingSignature = null
  if (matchingSignature !== undefined && matchingSignature !== prevMatchingSignature) {
    setPrevMatchingSignature(matchingSignature)
    setSelectedViewId(matchingSignature)
  }
  const activeView = selectedViewId != null ? (viewsQuery.data ?? []).find((v) => v.id === selectedViewId) ?? null : null
  // dirty: 활성 뷰가 있고 현재 URL 쿼리가 그 뷰의 저장된 쿼리와 (view 무시) 다르다.
  const isViewDirty = !!activeView && !groupPending && !queriesEqualIgnoringView(currentQuery, activeView.query)

  // 전체 칩 — 모든 파라미터 제거(그룹도 화면 기본값으로).
  const applyAll = () => setParams(new URLSearchParams(), { replace: true })
  // 저장 뷰 적용 — group 이 없는 (사이클 그룹 도입 전) 뷰는 group=none 을 명시해 예전처럼 평면 목록으로 연다(#878).
  const apply = (query: string) => setParams(savedViewQueryToParams(query), { replace: true })

  // "뷰 업데이트" — 이름/가시성은 유지하고 query 만 현재 필터로 교체(재생성 아님, 동일 id PATCH).
  // 공유(SHARED) 뷰는 갱신이 다른 사람에게도 즉시 반영되므로 확인 대화상자를 거친다.
  const updateActiveView = (v: SavedViewResponse) => {
    if (v.visibility === 'SHARED') {
      setUpdateConfirmTarget(v)
      return
    }
    update.mutate({ id: v.id, body: { name: v.name, query: currentQuery, visibility: v.visibility } })
  }

  // 칩 활성 판정 — 필터 없이 view 만 저장된 뷰(예: "view=board" 전용)는 view 무시 비교 시 빈 쿼리와
  // 같아져 "전체"와 동시에 활성화될 수 있다 — 그 영역은 전체의 몫이므로 제외한다 (#599).
  const isViewActive = (v: SavedViewResponse) => !isAllActive && queriesEqualIgnoringView(currentQuery, v.query)

  // 공유 뷰 업데이트 확인 대화상자의 「업데이트」 — 대상 뷰의 query 만 현재 필터로 교체하고 대화상자를 닫는다.
  const confirmUpdate = () => {
    if (updateConfirmTarget) {
      update.mutate({
        id: updateConfirmTarget.id,
        body: { name: updateConfirmTarget.name, query: currentQuery, visibility: updateConfirmTarget.visibility },
      })
    }
    setUpdateConfirmTarget(null)
  }

  return {
    views: viewsQuery.data ?? [],
    currentQuery,
    isAllActive,
    hasNothingToSave,
    activeView,
    isViewDirty,
    isViewActive,
    applyAll,
    apply,
    updateActiveView,
    updateConfirmTarget,
    setUpdateConfirmTarget,
    confirmUpdate,
  }
}
