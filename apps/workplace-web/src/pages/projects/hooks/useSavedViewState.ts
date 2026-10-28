// 저장된 뷰 상태 훅 — 데스크톱 ViewChipBar 와 모바일 뷰 칩 행이 공유한다.
// 현재 URL 쿼리와 저장 뷰의 일치·dirty 판정, 칩 적용/뷰 업데이트 동작을 담당한다.
import { startTransition, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import { useProject } from '../../../hooks/queries/useProjects'
import { useSavedViews, useUpdateSavedView } from '../../../hooks/queries/useSavedViews'
import { useIssueGroupBy } from '../../../hooks/useIssueGroupBy'
import { liveSearchParams } from '../../../lib/historyParam'
import { isAllIgnoringEpicScope } from '../../../lib/issueFacetFilters'
import { filtersToParams, parseFilters, parseView } from '../../../lib/issueFilters'
import { COLS_PARAM, type IssueListColumnKey, serializeColumns } from '../../../lib/issueListColumns'
import { isIntakeOnly } from '../../../lib/projectPermissions'
import {
  linkedSavedViewId,
  queriesEqualIgnoringView,
  queryHasNoFilters,
  savedViewMatches,
  savedViewQueryToParams,
  savedViewShowsDisplayChoice,
  savedViewUpdateQuery,
  syncSavedViewColumns,
} from '../../../lib/savedViewQuery'
import type { SavedViewResponse } from '../../../types/savedView'
import { useIssueListColumns } from './useIssueListColumns'

export interface SavedViewState {
  // 저장된 뷰를 쓸 수 있는가 — 서버가 목록·저장 모두 멤버 전용이라 OPEN 비멤버(접수만 하는 열람자)는 false(WP-741)
  canUseViews: boolean
  views: SavedViewResponse[]
  currentQuery: string // 현재 필터(열 제외) — 열을 담지 않는 뷰 저장의 기본 페이로드
  currentQueryWithColumns: string // 현재 필터 + 지금 고른 열(cols) — 「현재 열 구성도 함께 저장」을 켰을 때의 페이로드
  chosenColumns: IssueListColumnKey[] // 지금 고른 열(자동 완료일 열 제외) — 저장 창의 열 안내 문구
  canSaveColumns: boolean // 열 구성을 담을 수 있는 화면인가 — 열이 보이는 목록 보기만(보드는 열이 없다)
  isAllActive: boolean // 「전체」 칩 — 필터가 없고 고른 뷰도 없다
  isAllActiveIgnoringEpic: boolean // 모바일 「전체」 판정 — 에픽 범위(parent/topLevel)만 걸린 상태도 전체로 본다
  hasNothingToSave: boolean
  activeView: SavedViewResponse | null
  isViewDirty: boolean
  isViewActive: (v: SavedViewResponse) => boolean // 지금 일치하는 뷰(고른 뷰 우선, savedViewMatches — 열은 담은 뷰만 비교)이거나 고치는 중인 뷰인가
  isViewModified: (v: SavedViewResponse) => boolean // 고른 뷰인데 조건이 저장본과 달라졌는가 — 칩·라벨의 「수정됨」(WP-1022)
  applyAll: () => void
  apply: (v: SavedViewResponse) => void // 고른 뷰를 기억한다(WP-473 — 조건이 같은 뷰가 여럿이어도 고른 하나만 활성)
  select: (id: number) => void // URL 은 그대로 두고 그 뷰를 고른 뷰로 — 막 만든 뷰를 활성으로(지금 화면이 곧 그 뷰다)
  updateActiveView: (v: SavedViewResponse) => void // SHARED 면 확인 대상 설정
  updateConfirmTarget: SavedViewResponse | null
  setUpdateConfirmTarget: (v: SavedViewResponse | null) => void
  confirmUpdate: () => void
}

export function useSavedViewState(projectKey: string): SavedViewState {
  const [params, setParams] = useSearchParams()
  // 프로젝트를 불러오기 전엔 멤버인지 모르므로 요청을 미룬다 — 비멤버에게 403 이 매번 나던 문제(WP-741).
  const project = useProject(projectKey).data
  const canUseViews = !!project && !isIntakeOnly(project)
  const viewsQuery = useSavedViews(projectKey, canUseViews)
  const update = useUpdateSavedView(projectKey)
  // 필터 갱신(#777) — "마지막으로 선택된 뷰" id. 칩 클릭/생성 직후엔 쿼리 내용으로 자동
  // 동기화되지만, 이후 사용자가 필터를 바꿔 더 이상 어떤 뷰의 쿼리와도 일치하지 않게 되어도
  // (dirty 상태) 이 값은 유지되어야 "뷰 업데이트" 대상이 누구인지 알 수 있다.
  const [selectedViewId, setSelectedViewId] = useState<number | null>(null)
  // 사용자가 칩(또는 뷰 저장)으로 직접 고른 뷰 id — 주소가 우연히 같아 저절로 잡힌 뷰와 구분한다(WP-1022).
  // 필터 없는 뷰는 직접 고른 것만 그룹·열을 바꿔도 「수정됨」으로 붙잡는다 — 「전체」에서 그룹만 돌려 보다 지나친 뷰가 남지 않게.
  const [pickedViewId, setPickedViewId] = useState<number | null>(null)
  // matchingSignature 변화 감지용 — 렌더 중 setState 패턴에서 무한루프 방지.
  const [prevMatchingSignature, setPrevMatchingSignature] = useState<number | null | undefined>(undefined)
  // 뷰 목록·기본 그룹이 처음 정해졌는가 — 그 시점에 주소로 잡힌 뷰만 「열어 둔 뷰」로 본다(WP-1022). 일치 여부와 따로 기록한다 —
  // 어느 뷰와도 맞지 않는 주소(?status=TODO)로 열었을 때도 「처음」이 끝나야, 그 뒤 화면 안에서 맞은 뷰가 고른 뷰가 되지 않는다(#773).
  const [settledOnce, setSettledOnce] = useState(false)
  // 링크(사이드바 고정 뷰)가 넘긴 뷰를 이미 반영한 이동 — 같은 이동에서 다시 고르지 않게 location.key 로 가른다.
  const location = useLocation()
  const [handledLinkKey, setHandledLinkKey] = useState<string | null>(null)
  // 업데이트 확인 대화상자 대상 뷰(SHARED 뷰만) — null 이면 닫힘.
  const [updateConfirmTarget, setUpdateConfirmTarget] = useState<SavedViewResponse | null>(null)

  // 실제 적용 중인 그룹 — URL 에 group 이 없으면 사이클 유무로 정해지는 기본값(#878).
  // pending(사이클 목록 로딩 중)엔 유효 그룹을 아직 모르므로 저장 뷰 매칭·dirty 판정을 보류한다(아래).
  const { raw: groupParam, groupBy, pending: groupPending } = useIssueGroupBy(projectKey, true)
  // 현재 URL 필터를 canonical 쿼리스트링으로 — 저장 뷰 페이로드(뷰 저장/수정 다이얼로그)에 사용.
  // group 도 포함해야 그룹이 저장 뷰에 영속된다 (#58). view(list/board) 도 그대로 저장.
  // group 은 항상 명시한다(없음='none') — 저장 뷰의 group 부재는 '그룹 없음'으로 해석되므로(#878), 기본(사이클) 그룹으로
  // 보던 화면을 저장하면 'cycle' 이 기록돼야 다시 열었을 때 같은 화면이 된다.
  // 열 구성(cols, WP-270)은 저장 창에서 「현재 열 구성도 함께 저장」을 켰을 때만 싣는다(사용자 결정, 스펙 4.7) —
  // 그래서 열 없는 쿼리(currentQuery)와 열 포함 쿼리(currentQueryWithColumns)를 함께 만든다. 열은 사용자가 고른 것(chosen)만이고
  // 완료일 필터의 자동 완료일 열은 뺀다(필터와 함께 저장되므로 열면 다시 자동으로 붙는다).
  // 일치·dirty 는 savedViewMatches 가 본다 — 열을 담은 뷰만 열까지 비교하고(열만 바꿔도 「수정됨」), 안 담은 뷰는 열을 무시한다
  // (예전 뷰가 개인 열 때문에 「수정됨」이 되지 않게). 「전체」 판정은 언제나 열을 무시한다.
  const filters = parseFilters(params)
  const view = parseView(params)
  const { chosen: chosenColumns } = useIssueListColumns(projectKey, filters.closedIn != null)
  const queryParams = filtersToParams(filters, view, groupParam ?? groupBy ?? 'none')
  const currentQuery = queryParams.toString()
  queryParams.set(COLS_PARAM, serializeColumns(chosenColumns))
  const currentQueryWithColumns = queryParams.toString()
  // 「필터 없음」 판정은 view·group 을 모두 제외하고 비교한다 (#599, #773) — 리스트/보드
  // 전환이나 그룹 변경만으로 「전체」가 꺼지지 않게. group 은 필터가 아니라 표시 옵션이다.
  const noFilters = queryHasNoFilters(currentQuery)
  // 그룹·열을 주소에 직접 골라 둔 상태인가 — 저장 뷰를 적용하면 늘 group 을 명시한다(savedViewQueryToParams).
  // 필터 없는 뷰는 이때만 일치 후보가 된다(WP-1022). 기본 그룹·개인 열로 보는 처음 화면은 여전히 「전체」다.
  const displayChosen = groupParam != null || params.has(COLS_PARAM)
  // "뷰 저장" 버튼 비활성 판정은 기존대로 group 을 포함해 본다 — group 만 설정된 상태도
  // 저장할 가치가 있는 뷰이기 때문(#58 그룹 영속 테스트). 단 group 은 URL 원값 기준 — 명시하지 않은 기본 그룹은
  // 필터 없는 초기 화면과 같아 저장할 것이 없다.
  const hasNothingToSave = noFilters && groupParam == null

  // 현재 쿼리 내용과 일치하는 저장 뷰(있다면) — 칩 클릭/생성 직후 selectedViewId 동기화에 사용.
  // 기본 그룹 판정 보류 중엔 매칭하지 않는다 — 임시 그룹으로 잘못 매칭된 뷰가 selectedViewId 에 남으면,
  // 판정이 끝난 뒤 불일치(dirty)로 보여 「뷰 업데이트」가 뜬다.
  // 조건이 같은 뷰가 여럿이면 마지막으로 고른 뷰를 우선한다(WP-473) — 첫 일치만 보면 다른 이름이 활성으로 보였다.
  // 고른 뷰가 필터는 그대로인데 열만 달라졌으면(열을 담은 뷰에서 열을 바꿈) 다른 뷰로 넘기지 않는다 — 필터가 같은 열 없는 뷰로
  // 활성이 옮겨 가면 고른 뷰의 「수정됨」·「뷰 업데이트」가 사라진다. 일치 없음으로 두어 고른 뷰를 dirty 로 유지한다.
  const views = viewsQuery.data ?? []
  // 저장 뷰 링크로 들어온 이동이면 그 뷰를 칩으로 고른 것과 같게 기억한다(WP-1022) — 이슈 화면 안에서 고정 뷰를 눌러도,
  // 다른 화면에서 들어와도 같다. 이후 칩·그룹 변경은 replace 이동이라 state 가 없어 다시 걸리지 않는다.
  const linkedViewId = linkedSavedViewId(location.state)
  if (linkedViewId != null && location.key !== handledLinkKey) {
    setHandledLinkKey(location.key)
    setSelectedViewId(linkedViewId)
    setPickedViewId(linkedViewId)
  }
  const matches = (v: SavedViewResponse) => savedViewMatches(currentQueryWithColumns, v.query)
  const selectedView = selectedViewId != null ? views.find((v) => v.id === selectedViewId) : undefined
  // 필터가 없는 화면에서 일치 후보가 되는 뷰 — 그룹(없음 아님)·열을 담은 뷰는 주소만으로, 보드 전용·그룹 없음 뷰(#599)는 직접 고른 동안만.
  const eligible = (v: SavedViewResponse) => !noFilters || v.id === pickedViewId || savedViewShowsDisplayChoice(v.query)
  const pickMatchingView = (): SavedViewResponse | undefined => {
    if (selectedView && eligible(selectedView) && matches(selectedView)) return selectedView
    if (selectedView && queriesEqualIgnoringView(currentQuery, selectedView.query)) return undefined
    return views.find((v) => eligible(v) && matches(v))
  }
  const matchingView = (!noFilters || displayChosen) && !groupPending ? pickMatchingView() : undefined
  // #777: 필터가 활성 뷰의 쿼리와 일치하는 동안에는 selectedViewId 를 그 뷰로 유지/동기화하고,
  // "전체" 로 돌아가면 초기화한다. 필터만 바뀌어 더 이상 일치하지 않는 경우(dirty)는 그대로 유지해
  // "뷰 업데이트" 대상을 잃지 않는다 — 필터 없는 뷰를 직접 고른 채 그룹·열만 바꾼 경우도 dirty 로 유지한다(WP-1022).
  // 렌더 중 조건부 setState(React 권장 패턴)로 처리해 불필요한 effect 왕복 렌더를 피한다 — matchingSignature 로 실제 변화가 있을 때만 반영.
  const keepPickedFilterless =
    displayChosen && !!selectedView && selectedView.id === pickedViewId && queryHasNoFilters(selectedView.query)
  // 뷰 목록을 받기 전·기본 그룹을 모르는 동안은 판정을 보류한다.
  const settled = !groupPending && !!viewsQuery.data
  if (settled && !settledOnce) {
    // 화면을 처음 열 때(새로고침·주소로 열기) 주소로 잡힌 뷰는 그 뷰를 열어 둔 것이라 직접 고른 것으로 본다 —
    // 그 뒤 그룹만 바꿔도 「전체」로 떨어지지 않고 「수정됨」이 된다(WP-1022). 화면 안에서 그룹을 돌리다 잡힌 뷰는 아니다(#773).
    setSettledOnce(true)
    if (matchingView) setPickedViewId(matchingView.id)
  }
  let matchingSignature: number | null | undefined
  if (!settled) matchingSignature = undefined
  else if (matchingView) matchingSignature = matchingView.id
  else if (noFilters && !keepPickedFilterless) matchingSignature = null
  if (matchingSignature !== undefined && matchingSignature !== prevMatchingSignature) {
    setPrevMatchingSignature(matchingSignature)
    setSelectedViewId(matchingSignature)
  }
  const activeView = selectedView ?? null
  // dirty: 활성 뷰가 있고 현재 화면이 그 뷰와 (view 무시, 열은 뷰가 담았을 때만) 다르다.
  const isViewDirty = !!activeView && !groupPending && !matches(activeView)
  // 「전체」 칩 — 필터가 없고 고른 뷰도 없을 때만. 그룹·열만 담은 뷰를 고르면 「전체」가 아니라 그 뷰가 켜진다(WP-1022).
  const isAllActive = noFilters && !activeView
  // 모바일 「전체」 판정(WP-194) — 모바일은 에픽 범위(parent/topLevel)를 옆의 「◆ 에픽」 칩이 따로 보여주므로,
  // 저장 뷰가 활성이 아니면서 에픽 범위만 걸린 상태도 「전체」로 본다. 뷰 칩 라벨과 뷰 시트 「전체」 ✓ 가 함께 쓴다.
  // 데스크톱 ViewChipBar·저장 뷰 매칭은 isAllActive 그대로.
  const isAllActiveIgnoringEpic = isAllActive || isAllIgnoringEpicScope(filters, !!activeView)

  // 칩 적용은 고른 뷰 상태와 주소를 한 전환(transition)에 묶는다(WP-1049) — 라우터(BrowserRouter)는 주소 갱신을
  // startTransition 으로 늦게 커밋한다. 고른 뷰 상태만 먼저 커밋되면 한 프레임 동안 옛 주소와 새 뷰가 섞여
  // 칩 둘이 켜지거나 「전체」로 튀고, 새 칩에 「수정됨」·뷰 업데이트 버튼이 비쳤다. 같은 이벤트의 전환은 한 번에 커밋된다.
  // 전체 칩 — 모든 파라미터 제거(그룹도 화면 기본값으로). 고른 뷰도 잊는다.
  // 서명(prev)도 함께 비워 둔다 — 남아 있으면 나중에 같은 뷰가 다시 일치해도 「변화 없음」으로 걸러져 고른 뷰가 잡히지 않는다.
  const applyAll = () =>
    startTransition(() => {
      setSelectedViewId(null)
      setPickedViewId(null)
      setPrevMatchingSignature(null)
      setParams(new URLSearchParams(), { replace: true })
    })
  // 저장 뷰 적용 — group 이 없는 (사이클 그룹 도입 전) 뷰는 group=none 을 명시해 예전처럼 평면 목록으로 연다(#878).
  // 고른 뷰 id 를 먼저 기억해 둔다 — 같은 조건의 다른 뷰가 활성으로 잡히지 않게(WP-473).
  const apply = (v: SavedViewResponse) =>
    startTransition(() => {
      setSelectedViewId(v.id)
      setPickedViewId(v.id)
      setParams(savedViewQueryToParams(v.query), { replace: true })
    })

  // 막 저장한 뷰를 고른 뷰로 — 일치 판정에 맡기면 열만 바꾼 예전 뷰(필터는 같음)가 고른 뷰로 남아 새 뷰가 활성이 되지 않았다.
  // 「마지막으로 고른 뷰가 이긴다」(WP-473)를 생성에도 적용한다. 목록 캐시에는 생성 훅이 먼저 넣어 둔다.
  const select = (id: number) => {
    setSelectedViewId(id)
    setPickedViewId(id)
  }

  // "뷰 업데이트" — 이름/가시성은 유지하고 query 만 현재 필터로 교체(재생성 아님, 동일 id PATCH).
  // 열은 뷰의 선택을 지킨다 — 열을 담은 뷰면 지금 열까지, 안 담은 뷰면 열 없이(savedViewUpdateQuery).
  // 공유(SHARED) 뷰는 갱신이 다른 사람에게도 즉시 반영되므로 확인 대화상자를 거친다.
  // 갱신에 성공하면 URL cols 를 저장된 뷰에 맞춘다(syncSavedViewColumns) — 열을 담은 뷰가 URL cols 없이 활성이던 화면에서도
  // 이후 열 변경이 개인 저장값이 아니라 뷰(URL)를 바꾸게. 기준은 응답 시점의 지금 주소다(WP-955) — setParams 의 prev 는
  // 저장을 누른 렌더의 URL 이라, 응답을 기다리는 사이 바꾼 필터·열을 되돌려 버린다.
  const updateView = (v: SavedViewResponse) => {
    const query = savedViewUpdateQuery(v.query, currentQueryWithColumns)
    update.mutate(
      { id: v.id, body: { name: v.name, query, visibility: v.visibility } },
      {
        onSuccess: () =>
          setParams(syncSavedViewColumns(liveSearchParams(), query), { replace: true }),
      },
    )
  }
  const updateActiveView = (v: SavedViewResponse) => {
    if (v.visibility === 'SHARED') {
      setUpdateConfirmTarget(v)
      return
    }
    updateView(v)
  }

  // 칩 활성 판정 — 필터 없이 view 만 저장된 뷰(예: "view=board" 전용)는 주소만으로는 켜지지 않는다(#599, eligible).
  // 조건이 같은 뷰가 여럿이어도 하나만 — 지금 일치하는 뷰(고른 뷰 우선)만 활성이다(WP-473).
  // 고른 뷰의 조건을 바꾼(dirty) 동안, 기본 그룹을 아직 몰라 판정을 미룬 동안에도 그 뷰를 켜 둔다 —
  // 어떤 뷰를 고치는 중인지 보이게(「수정됨」 표시와 함께, WP-1022), 판정 보류 중 칩이 하나도 안 켜진 채 깜빡이지 않게.
  const isViewModified = (v: SavedViewResponse) => isViewDirty && activeView?.id === v.id
  const isViewActive = (v: SavedViewResponse) =>
    matchingView?.id === v.id || (activeView?.id === v.id && (isViewDirty || groupPending))

  // 공유 뷰 업데이트 확인 대화상자의 「업데이트」 — 대상 뷰의 query 만 현재 필터로 교체하고 대화상자를 닫는다.
  const confirmUpdate = () => {
    if (updateConfirmTarget) updateView(updateConfirmTarget)
    setUpdateConfirmTarget(null)
  }

  return {
    canUseViews,
    views,
    currentQuery,
    currentQueryWithColumns,
    chosenColumns,
    canSaveColumns: view === 'list',
    isAllActive,
    isAllActiveIgnoringEpic,
    hasNothingToSave,
    activeView,
    isViewDirty,
    isViewActive,
    isViewModified,
    applyAll,
    apply,
    select,
    updateActiveView,
    updateConfirmTarget,
    setUpdateConfirmTarget,
    confirmUpdate,
  }
}
