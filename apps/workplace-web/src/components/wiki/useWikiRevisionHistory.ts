import type { Node as PMNode } from '@tiptap/pm/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useHistoryParam } from '@/hooks/useHistoryParam'
import { parseId } from '@/lib/historyParam'

import { useRestoreWikiRevision, useWikiRevision, useWikiRevisions } from '../../hooks/queries/useWikiRevisions'
import type { WikiRevisionItem } from '../../types/wiki'
import { revisionVersionLabel } from './wikiRevisionFormat'

/** 버전 기록 열림 쿼리 키 — `?history=1`. 닫으면 선택(rev)도 함께 지운다. */
const REVISION_HISTORY_PARAM = 'history'
/** 미리보기 중인 판 쿼리 키 — `?rev={version}`. 없으면 미리보기 없음(현재 버전). */
const REVISION_SELECTED_PARAM = 'rev'
/** AI 작성 중 판 고르기를 막을 때의 사유(목록 머리 안내·각 줄 aria-description). */
const REVISION_BLOCKED_BY_AI = 'AI 작성 중에는 이전 버전을 볼 수 없습니다'

/**
 * 노트 버전 기록(WP-282)의 열림·선택·비교 상태 — 데스크톱 패널(Task 6)과 모바일 전체화면(Task 7)이 함께 쓴다.
 *
 * - 열림·선택은 URL 쿼리(useHistoryParam)에 둔다 — 뒤로가기가 미리보기 → 목록 → 노트 순으로 닫는다(WP-204 패턴).
 * - 비교 대상(compareTo): 목록에서 바로 위(더 최신) 판 본문. 맨 위 판이면 라이브 에디터 문서의 **스냅샷**(그 판을 고른 순간의 doc) —
 *   입력마다 바뀌는 doc 을 그대로 넘기면 원격 입력마다 차이를 다시 계산한다(WikiRevisionPreview 주석).
 * - openLatest: 복귀 토스트 "변경 보기" — 패널을 열고 목록이 (새로) 도착하면 최신 판을 골라 변경 표시를 켠다.
 *   열기와 고르기를 한 번에 navigate 할 수 없다(useHistoryParam 은 지난 위치의 두 번째 호출을 버린다)라 목록 도착 뒤 effect 가 고른다.
 *
 * @param getLiveDoc 지금 에디터 문서(불변 PM 노드) — 맨 위 판을 고른 순간 한 번 읽는다. 에디터가 없으면 null.
 * @param opts.liveReady 라이브 문서가 첫 동기화를 마쳤는지 — 전엔 빈 문서라 스냅샷을 찍지 않고(`?history=1&rev=<최신>` 콜드 진입),
 *   준비되는 순간 다시 찍는다.
 * @param opts.selectionBlocked 판 고르기를 막는다(AI 작성 중 — 결과가 가려진 라이브 노트에 들어가는 동안 미리보기로 바꾸지 않는다).
 *   막힌 동안엔 주소에 rev 가 있어도 미리보기 없음으로 보고, "변경 보기" 는 패널만 연다.
 * @param opts.accessLost 노트가 지워졌거나 접근을 잃었는지 — 열려 있으면 닫는다(기록도 더는 받을 수 없다).
 */
export function useWikiRevisionHistory(
  pageId: number,
  getLiveDoc: () => PMNode | null,
  { liveReady, selectionBlocked, accessLost }: { liveReady: boolean; selectionBlocked: boolean; accessLost: boolean },
) {
  const history = useHistoryParam(REVISION_HISTORY_PARAM, { clear: [REVISION_SELECTED_PARAM] })
  const rev = useHistoryParam(REVISION_SELECTED_PARAM)
  const isOpen = history.value != null
  const closeHistory = history.close
  useEffect(() => {
    if (isOpen && accessLost) closeHistory()
  }, [isOpen, accessLost, closeHistory])
  // 패널이 닫혀 있으면 남은 rev 는 무시한다(직접 붙여 넣은 주소 등). 고르기가 막힌 동안도 미리보기 없음.
  const selectedVersion = isOpen && !selectionBlocked ? parseId(rev.value) : null

  const list = useWikiRevisions(pageId, { enabled: isOpen })
  const items = useMemo(() => list.data?.items ?? [], [list.data])
  const selectedIndex = selectedVersion == null ? -1 : items.findIndex((i) => i.version === selectedVersion)
  const selectedItem: WikiRevisionItem | null = selectedIndex >= 0 ? items[selectedIndex] : null
  const newerItem = selectedIndex > 0 ? items[selectedIndex - 1] : null
  const isNewest = selectedIndex === 0

  const detail = useWikiRevision(pageId, selectedVersion)
  const newerDetail = useWikiRevision(pageId, newerItem?.version ?? null)

  // "변경 보기" 요청 순번 — 아래 스냅샷도 이 값이 바뀌면 다시 찍는다(이미 최신 판을 보고 있어도 돌아와 받은 변경을 비교하게).
  const [latestTick, setLatestTick] = useState(0)

  // 맨 위 판의 비교 대상 — 그 판을 고른 순간(또는 "변경 보기"·첫 동기화 완료 순간)의 라이브 문서. 입력마다 다시 찍지 않는다.
  const liveSnapshot = useMemo(
    () => (isNewest && liveReady ? getLiveDoc() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 고른 순간 한 번만 찍는다(getLiveDoc 은 안정된 콜백)
    [isNewest, selectedVersion, liveReady, latestTick],
  )
  const compareTo: PMNode | string | null = isNewest ? liveSnapshot : (newerDetail.data?.body ?? null)

  // 변경 표시 — 기본 켬. 판을 넘겨도 사용자가 고른 값을 유지한다.
  const [showDiff, setShowDiff] = useState(true)

  // "변경 보기" 요청 — 요청 시각 이후에 받은 목록에서 최신 판을 고른다(캐시에 남은 이전 목록으로 고르지 않게).
  const latestRequestRef = useRef<number | null>(null)
  const { isFetching, isSuccess, dataUpdatedAt, refetch } = list
  const openLatest = useCallback(() => {
    // AI 작성 중이면 패널만 연다(고르기는 막혀 있다).
    if (!selectionBlocked) {
      latestRequestRef.current = Date.now()
      setLatestTick((n) => n + 1)
      setShowDiff(true)
    }
    if (isOpen) void refetch()
    else history.open('1')
  }, [selectionBlocked, isOpen, refetch, history])
  useEffect(() => {
    const requestedAt = latestRequestRef.current
    if (requestedAt == null || !isOpen || isFetching || !isSuccess || dataUpdatedAt < requestedAt) return
    latestRequestRef.current = null
    const latest = items[0]
    if (latest) rev.open(String(latest.version))
  }, [latestTick, isOpen, isFetching, isSuccess, dataUpdatedAt, items, rev])

  // 판 고르기·현재 버전(미리보기 해제).
  const select = useCallback(
    (version: number) => {
      if (!selectionBlocked) rev.open(String(version))
    },
    [selectionBlocked, rev],
  )
  const clearSelection = rev.close

  // 복원 — 성공하면 "{판 이름}으로 복원했어요"(오늘 "14:05 버전", 어제 "어제 17:48 버전") 후 미리보기를 닫는다. 실패 토스트는 useRestoreWikiRevision 이 띄운다.
  // - 데스크톱: 패널은 둔다(목록이 새로 받아져 "복원 전" 판이 보인다).
  // - 모바일(closeHistory): 목록까지 닫고 노트로 돌아간다 — 복원 결과(본문)를 바로 보게.
  //   미리보기·목록을 한 번에 닫으려 rev·history 를 연달아 닫으면 두 번째 navigate 가 버려진다(useHistoryParam).
  //   history 닫기 하나로 충분하다 — 연 표식이 있으면 목록을 열기 직전 항목으로 돌아가(rev 항목도 함께 지나간다),
  //   콜드 진입이면 clear 로 rev 도 함께 지운다.
  const { mutate: restoreMutate, isPending: restoring } = useRestoreWikiRevision(pageId)
  const restore = useCallback(
    (opts: { closeHistory?: boolean } = {}) => {
      if (!selectedItem) return
      const { version, editedAt } = selectedItem
      restoreMutate(version, {
        onSuccess: () => {
          toast.success(`${revisionVersionLabel(editedAt)}으로 복원했어요`)
          if (opts.closeHistory) history.close()
          else rev.close()
        },
      })
    },
    [selectedItem, restoreMutate, rev, history],
  )

  return {
    isOpen,
    open: () => history.open('1'),
    close: history.close,
    openLatest,
    list,
    selectedVersion,
    selectedItem,
    detail,
    compareTo,
    showDiff,
    setShowDiff,
    select,
    clearSelection,
    restore,
    restoring,
    /** 판 고르기가 막혔으면 그 사유(목록이 머리 안내·각 줄 비활성으로 보인다), 아니면 undefined. */
    blockedReason: selectionBlocked ? REVISION_BLOCKED_BY_AI : undefined,
  }
}

export type WikiRevisionHistory = ReturnType<typeof useWikiRevisionHistory>
