// 홈 대시보드 편집 초안 훅(WP-161 에서 Dashboard.tsx 로부터 분리) — 편집 시작 기기·로컬 초안·여러 단계 undo 와
// 그 위의 편집 액션(이동·드래그 재배치·숨김·테두리·항목 수·추가·삭제·설정·되돌리기·저장)을 한곳에 모은다.
// 화면(헤더·배너·목록)은 Dashboard 가, dnd 골격·카드 ref·포커스 복원은 DashboardWidgetList 가 맡는다.
import { arrayMove } from '@dnd-kit/sortable'
import { type SetStateAction, useEffect, useRef, useState } from 'react'

import { useIsDashboardSaving, useSaveDashboardLayout } from '@/hooks/queries/useDashboard'
import { handleApiError } from '@/lib/api-error'
import type { DashboardDevice, DashboardWidgetConfig } from '@/types/dashboard'

import { getCatalogWidget } from '../widgets/catalogRegistry'
import { getDashboardWidget } from '../widgets/registry'
import { useDashboardEditDraftStore } from './DashboardEditDraftContext'
import { type CatalogConfigPatch, DEFAULT_COUNT, entryTitle, HIGHLIGHT_DURATION_MS, MAX_WIDGETS, resolveEntries, resolveEntry } from './resolvedEntry'

/** undo 스택 상한 — 넘으면 가장 오래된 스냅샷부터 버린다(편집이 길어져도 메모리가 무한히 늘지 않게). */
export const MAX_UNDO = 50

/** 값이 undefined 인 키를 뺀 키 목록 — JSON 으로 저장하면 사라지는 키라 「없는 키」와 같게 본다. */
function definedKeys(o: object): string[] {
  return Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined)
}

/**
 * JSON 값(객체·배열·원시값)의 구조 비교 — 객체 키 순서는 무시하고, 값이 undefined 인 키는 없는 키로 본다(저장하면 같아지므로).
 * 설정 적용이 실제로 바뀐 게 있는지 가르는 데 쓴다.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = definedKeys(a)
  const kb = definedKeys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * undo 스택에 스냅샷을 쌓는 순수 함수 — 상한(MAX_UNDO)을 넘으면 앞(가장 오래된 것)에서 잘라낸다.
 * 원본 스택은 바꾸지 않고 새 배열을 돌려준다.
 */
export function pushUndo(stack: DashboardWidgetConfig[][], snap: DashboardWidgetConfig[]): DashboardWidgetConfig[][] {
  // 음수 slice 는 상한보다 짧으면 전체를, 길면 뒤에서 MAX_UNDO 개를 돌려준다.
  return [...stack, snap].slice(-MAX_UNDO)
}

// 편집 세션 번호 발급기 — 모듈 수준이라 재마운트·주인(계정) 전환을 넘어 번호가 겹치지 않는다.
let editSessionSeq = 0

/** 키보드 이동(↑↓) 후 포커스 복원 요청 — token 은 같은 카드·같은 방향 연속 이동도 effect 를 다시 돌리기 위한 증가값. */
export interface MoveFocusRequest {
  id: string
  dir: -1 | 1
  token: number
}

interface Options {
  /** 지금 화면 기기(lg 미만 = 모바일). 편집은 시작한 기기에서만 보인다. */
  device: DashboardDevice
  /** 현재 기기의 저장된 위젯 목록 — 편집 시작 시 초안으로 복사한다. */
  savedWidgets: DashboardWidgetConfig[] | undefined
  /** 접기 저장 중이면 편집 진입을 막는다(늦게 도착한 접기 PUT 이 편집 저장을 덮어쓰지 않게). */
  collapseSaving: boolean
}

/**
 * 편집 초안 상태와 편집 액션.
 *
 * - 초안(시작 기기·초안·undo 스택)은 DashboardEditDraftProvider 저장소에 있어 편집 중 lg 경계를 넘었다 돌아와도 유지된다(WP-162).
 * - 편집은 시작한 기기에 묶인다(editing = 시작 기기 === 현재 기기, 저장도 시작 기기로). 한 기기 초안이 다른 기기
 *   레이아웃에 저장되지 않도록 하는 안전장치다(WP-142).
 * - 저장 전까지 아무것도 영속화되지 않는다.
 */
export function useDashboardEditDraft({ device, savedWidgets, collapseSaving }: Options) {
  const save = useSaveDashboardLayout()
  // 진행 중 저장은 전역 mutation 캐시로 본다 — 저장 중 재마운트돼도 저장 버튼이 다시 살아나 이중 PUT 하지 않게.
  const isSaving = useIsDashboardSaving()
  // 시작 기기·초안·undo 는 셸 교체(lg 경계 리사이즈로 인한 Dashboard 재마운트)에도 살아 있는 저장소에 둔다(WP-162).
  const [{ editDevice, draft, undoStack, session }, setStore] = useDashboardEditDraftStore()
  // 기준 레이아웃(savedWidgets)이 없으면 편집 중이 아니다 — 조회 실패로 기준이 없는데 남은 초안을 저장하면 서버 레이아웃을
  // 볼 수 없는 채로 덮어쓴다(WP-1850). 다시 불러오면 남은 초안으로 편집이 이어진다.
  const editing = editDevice === device && savedWidgets !== undefined
  const setDraft = (action: SetStateAction<DashboardWidgetConfig[]>) =>
    setStore((s) => ({ ...s, draft: typeof action === 'function' ? action(s.draft) : action }))
  const [addModalOpen, setAddModalOpen] = useState(false)
  // 방금 추가된 위젯 id — 강조 표시 + 스크롤 이동 대상(4초 후 자동 해제).
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null)
  const recentlyAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 스크린리더 피드백(이동/숨김 등 편집 액션) — aria-live polite 로 알림.
  const [liveMsg, setLiveMsg] = useState('')
  // I2: 이동 후 포커스 복원 요청(실제 포커스 이동은 카드 ref 를 가진 DashboardWidgetList 가 한다).
  const [moveFocus, setMoveFocus] = useState<MoveFocusRequest | null>(null)
  const moveTokenRef = useRef(0)

  // 위젯 추가 강조 4초 후 자동 해제(스크롤 이동은 카드 ref 를 가진 DashboardWidgetList 가 한다).
  useEffect(() => {
    if (!recentlyAddedId) return
    // 이전 타이머는 매 재실행/언마운트 전 아래 cleanup 이 이미 정리하므로 여기서 다시 지울 필요 없다.
    recentlyAddedTimerRef.current = setTimeout(() => setRecentlyAddedId(null), HIGHLIGHT_DURATION_MS)
    return () => {
      if (recentlyAddedTimerRef.current) {
        clearTimeout(recentlyAddedTimerRef.current)
        recentlyAddedTimerRef.current = null
      }
    }
  }, [recentlyAddedId])

  /** 초안에서 id 의 표시 제목(없으면 id) — 공지 문구용. */
  function titleOf(id: string): string {
    const cur = draft.find((w) => w.id === id)
    const entry = cur ? resolveEntry(cur) : null
    return entry ? entryTitle(entry) : id
  }

  function enterEdit() {
    // 기준 레이아웃 없이 들어가면 빈 초안으로 시작해 저장 때 레이아웃을 덮어쓴다(WP-1850).
    if (collapseSaving || savedWidgets === undefined) return
    editSessionSeq += 1
    setStore({
      editDevice: device,
      draft: savedWidgets.map((w) => ({ ...w })),
      undoStack: [],
      session: editSessionSeq,
    })
    setLiveMsg('')
    setAddModalOpen(false)
    setRecentlyAddedId(null)
  }

  function cancelEdit() {
    setStore((s) => ({ ...s, editDevice: null, undoStack: [] }))
    setLiveMsg('')
    setAddModalOpen(false)
    setRecentlyAddedId(null)
  }

  // 편집 직전 초안을 undo 스택에 쌓는다. 업데이터 안에서 s.draft 를 읽어, 같은 틱에 연속 호출돼도 각 시점의 초안이 쌓인다.
  function snapshot() {
    setStore((s) => ({ ...s, undoStack: pushUndo(s.undoStack, s.draft.map((w) => ({ ...w }))) }))
  }

  // 위젯 이동(위/아래) — 드래프트 배열 내 순서 교환. id 기반.
  function moveWidget(id: string, dir: -1 | 1) {
    // I1: setDraft 업데이터 안에서 title 을 계산하면 setLiveMsg 호출 시점엔 아직 반영 전(stale) 값을 읽게 되므로,
    // 다른 핸들러(toggleHidden 등)와 동일하게 항상 최신인 draft 로 핸들러에서 먼저 계산한다.
    const title = titleOf(id)
    // 범위 밖이면 아무 일도 하지 않는다 — 스냅샷·공지·포커스 요청도 남기지 않는다(양 끝에서 단추가 꺼져 UI 로는 안 닿는 방어 가드).
    const i = draft.findIndex((w) => w.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= draft.length) return
    snapshot()
    setDraft((prev) => {
      // 렌더 시점 draft 가 낡았을 수 있어(같은 틱 연속 호출) 최신 prev 기준으로 위치를 다시 구해 방어한다.
      const from = prev.findIndex((w) => w.id === id)
      const to = from + dir
      if (from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setLiveMsg(`${title} 위젯을 ${dir < 0 ? '위로' : '아래로'} 이동했습니다`)
    moveTokenRef.current += 1
    setMoveFocus({ id, dir, token: moveTokenRef.current })
  }

  // 드래그 종료 — active 위젯을 over 위젯 자리로 재배치. moveWidget 과 동일하게 undo 스냅샷 + 공지.
  // 포인터 드래그는 키보드 포커스 이동이 없으므로 moveWidget 의 포커스 복원(moveTokenRef/setMoveFocus)이 불필요하다.
  function reorderWidget(activeId: string, overId: string) {
    if (activeId === overId) return
    // 새 위치는 업데이터 밖에서 현재 초안으로 계산한다 — 초안이 공유 저장소(한 state)에 있어 snapshot() 갱신 뒤의
    // 업데이터는 즉시 실행되지 않으므로, 업데이터 안에서 잡은 값으로는 공지 문구를 만들 수 없다(WP-162).
    const oldIdx = draft.findIndex((w) => w.id === activeId)
    const overIdx = draft.findIndex((w) => w.id === overId)
    if (oldIdx < 0 || overIdx < 0) return
    const title = titleOf(activeId)
    snapshot()
    setDraft((prev) => {
      const from = prev.findIndex((w) => w.id === activeId)
      const to = prev.findIndex((w) => w.id === overId)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
    setLiveMsg(`${title} 위젯을 ${overIdx + 1}번째 위치로 이동했습니다`)
  }

  // 표시/숨김 토글. id 기반.
  function toggleHidden(id: string) {
    const cur = draft.find((w) => w.id === id)
    const nowHidden = cur ? !cur.hidden : true
    const title = titleOf(id)
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, hidden: nowHidden } : w)))
    setLiveMsg(`${title} 위젯을 ${nowHidden ? '숨김' : '표시'} 처리했습니다`)
  }

  // 테두리·제목 헤더 표시/숨김 토글(chromeless). id 기반 — hidden 과 동일 패턴.
  function toggleChromeless(id: string) {
    const cur = draft.find((w) => w.id === id)
    const nowChromeless = cur ? !cur.chromeless : true
    const title = titleOf(id)
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, chromeless: nowChromeless } : w)))
    setLiveMsg(`${title} 위젯 테두리·제목을 ${nowChromeless ? '숨김' : '표시'} 처리했습니다`)
  }

  // 위젯 추가 — 시스템 위젯은 이미 draft 에 있으면 무시(싱글턴), 카탈로그 위젯은 새 UUID 인스턴스로 추가.
  // 상한(MAX_WIDGETS) 도달 시 무시(모달 쪽에서도 버튼 비활성화로 방지, 여기는 방어적 가드).
  function addWidget(type: string) {
    if (draft.length >= MAX_WIDGETS) return
    const sys = getDashboardWidget(type)
    if (sys) {
      if (draft.some((w) => w.type === type)) return
      snapshot()
      // 편집 중인 기기의 기본 항목 수(편집 밖 호출은 없지만 null 이면 기존처럼 데스크톱 5).
      const count = DEFAULT_COUNT[editDevice ?? 'desktop']
      setDraft((prev) => [...prev, { id: type, type, count, hidden: false }])
      setLiveMsg(`${sys.title} 위젯을 추가했습니다`)
      setRecentlyAddedId(type)
      return
    }
    const cat = getCatalogWidget(type)
    if (!cat) return
    const id = crypto.randomUUID()
    snapshot()
    setDraft((prev) => [
      ...prev,
      { id, type, count: 0, hidden: false, params: cat.defaultParams, label: null },
    ])
    setLiveMsg(`${cat.title} 위젯을 추가했습니다`)
    setRecentlyAddedId(id)
  }

  // 카탈로그 위젯 삭제(완전 제거). 시스템 위젯은 숨김만 가능(호출부에서 카탈로그에만 노출).
  function removeWidget(id: string) {
    const title = titleOf(id)
    snapshot()
    setDraft((prev) => prev.filter((w) => w.id !== id))
    setLiveMsg(`${title} 위젯을 삭제했습니다`)
  }

  // 카탈로그 위젯 설정(필터/라벨) 적용 — 추가 시점 기본값 편집과 이후 편집이 동일 경로.
  function applyCatalogConfig(id: string, patch: CatalogConfigPatch) {
    // 폼은 기본 파라미터를 합쳐 채우므로 저장값도 기본값과 합쳐 비교한다. 같으면 바뀐 게 없으므로
    // 되돌리기 단계·공지를 만들지 않는다(적용 단추는 변경이 없어도 호출된다).
    // label 은 저장본에서 undefined·빈 문자열일 수 있는데 적용은 빈 이름을 null 로 보내므로 null 로 맞춰 비교한다.
    const cur = draft.find((w) => w.id === id)
    if (
      cur &&
      (cur.label || null) === (patch.label || null) &&
      jsonEqual({ ...getCatalogWidget(cur.type)?.defaultParams, ...cur.params }, patch.params)
    )
      return
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)))
    setLiveMsg('위젯 설정을 변경했습니다')
  }

  // 항목 수 변경(시스템 위젯 전용).
  function setCount(id: string, count: number) {
    // 이미 그 값이면 바뀐 게 없으므로 되돌리기 단계·공지를 만들지 않고 돌아간다.
    if (draft.find((w) => w.id === id)?.count === count) return
    const title = titleOf(id)
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, count } : w)))
    setLiveMsg(`${title} 위젯 항목 수를 ${count}개로 변경했습니다`)
  }

  function undo() {
    // 렌더 시점 스택이 비었으면 되돌릴 게 없으므로 「되돌렸습니다」 공지도 하지 않는다(아래 업데이터 검사는 최신 저장소 방어).
    if (undoStack.length === 0) return
    // 스택 끝(가장 최근 스냅샷)을 초안으로 되돌리고 나머지를 스택에 남긴다 — 한 번의 setStore 로 원자적으로.
    setStore((s) => {
      if (s.undoStack.length === 0) return s
      return { ...s, draft: s.undoStack[s.undoStack.length - 1], undoStack: s.undoStack.slice(0, -1) }
    })
    // 공지는 남은 단계 수를 넣어 매번 다른 문구로 만든다 — 같은 문구를 다시 넣으면 React 가 갱신을 건너뛰어
    // aria-live 가 연달아 누른 되돌리기를 읽지 않는다(여러 단계 되돌리기에서 처음 한 번만 들리는 문제).
    const left = undoStack.length - 1
    setLiveMsg(left > 0 ? `마지막 편집을 되돌렸습니다. ${left}단계 더 되돌릴 수 있습니다` : '편집을 시작한 상태로 모두 되돌렸습니다')
  }

  function saveEdit() {
    // 편집을 시작한 기기 레이아웃에만 저장한다(렌더 시점 device 가 아님).
    if (!editDevice) return
    // mutate 의 호출별 콜백은 저장 중 Dashboard 가 재마운트(lg 경계 리사이즈)되면 불리지 않아, 이미 저장된 초안으로
    // 편집 모드가 되살아난다. 프라미스로 받아 저장소(셸 밖 provider) 갱신이 재마운트와 무관하게 실행되게 한다(WP-162).
    // 단, 그사이 새 편집 세션이 시작됐으면 그 편집은 건드리지 않는다(session 비교).
    const savedSession = session
    save.mutateAsync({ device: editDevice, widgets: draft }).then(
      () => {
        setStore((s) => (s.session === savedSession ? { ...s, editDevice: null, undoStack: [] } : s))
        setLiveMsg('대시보드 레이아웃을 저장했습니다')
      },
      (err: unknown) => handleApiError(err, '대시보드 저장에 실패했습니다'),
    )
  }

  return {
    editing,
    draft,
    // 편집 드래프트 → 알려진 위젯만 해석(순서/숨김 모두 포함).
    draftEntries: resolveEntries(draft),
    canUndo: undoStack.length > 0,
    isSaving,
    addModalOpen,
    setAddModalOpen,
    recentlyAddedId,
    moveFocus,
    liveMsg,
    /** 편집 밖 액션(모바일 ⌃/⌄ 접기 등)의 스크린리더 공지. */
    announce: setLiveMsg,
    enterEdit,
    cancelEdit,
    moveWidget,
    reorderWidget,
    toggleHidden,
    toggleChromeless,
    addWidget,
    removeWidget,
    applyCatalogConfig,
    setCount,
    undo,
    saveEdit,
  }
}

/** useDashboardEditDraft 반환값 — 목록 컴포넌트가 편집 액션을 받을 때 쓴다. */
export type DashboardEditDraft = ReturnType<typeof useDashboardEditDraft>
