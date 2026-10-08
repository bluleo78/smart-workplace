import { ChevronLeft, ChevronRight, Cloud, Download, Minus, Plus, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useIsCoarsePointer } from '../../hooks/useIsCoarsePointer'
import { useIsLandscape } from '../../hooks/useIsLandscape'
import { getIsMobile, useIsMobile } from '../../hooks/useIsMobile'
import { useThemeColor } from '../../hooks/useThemeColor'
import { formatFileSize } from '../../lib/formatters'
import { isIOSDevice, isStandaloneDisplay } from '../../lib/platform'
import { resolvePreviewKind } from '../../lib/previewKind'
import { cn } from '../../lib/utils'
import { isInAiPanelDom } from '../ai/aiPanelSurface'
import { useAiPanelAwareDialog } from '../ai/useAiPanelAwareDialog'
import { FileTypeIcon } from '../drive/FileTypeIcon'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { downloadViewerItem } from './downloadViewerItem'
import type { ViewerItem } from './types'
import { useImportToDrive } from './useImportToDrive'
import { useSummaryAvailability } from './useSummaryAvailability'
import { useViewerGestures } from './useViewerGestures'
import { actionSlots, resolveSaveMethod, resolveShareState, type SlotId } from './viewerActions'
import { ViewerBacklinks } from './ViewerBacklinks'
import { ViewerBody } from './ViewerBody'
import { anchorScroll, stageTouchAction } from './viewerGestures'
import { ViewerActionBar, ViewerMobileTopBar } from './ViewerMobileBars'
import { ViewerMoreMenu } from './ViewerMoreMenu'
import { middleEllipsis, navState, resolvePending, routeKey } from './viewerNav'
import { canShareApi, canShareFile, shareFile } from './viewerShare'
import { ViewerSidePanel, ViewerSummarySheet } from './ViewerSidePanel'

/** 확대 단계(25%)와 범위. */
const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

/** 사이드 패널 마지막 열림 상태 저장 키('1' 열림 / '0' 닫힘) — 사용자가 직접 토글한 값만 기억한다. */
const PANEL_STORAGE_KEY = 'attachment-viewer:summary-panel'

/** 저장된 패널 상태를 읽는다 — 저장소 접근이 막힌 환경(사생활 모드 등)에서도 죽지 않게 try/catch. */
function readPanelPref(): boolean | null {
  try {
    const v = localStorage.getItem(PANEL_STORAGE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

const edgeBtnClass =
  'absolute top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring'

/**
 * 통합 첨부 뷰어(WP-276) — 다크 라이트박스. 묶음(items) 안에서 ‹ ›·←/→ 로 넘기고 이미지·PDF 는 확대한다(WP-277).
 * Radix Dialog 위에 그려 포커스 트랩·Esc·포커스 복귀를 그대로 쓰고,
 * useAiPanelAwareDialog 로 앱 AI 사이드 패널과 공존한다(WP-54) — side 모드면 패널 폭만큼 비켜선다.
 * 열림·현재 항목은 호출부가 useHistoryParam 으로 들고 있다(뒤로가기 = 닫기).
 */
export function AttachmentViewer({
  items,
  index,
  onIndexChange,
  onClose,
  defaultPanelOpen,
  shareable = true,
}: {
  items: ViewerItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  /** 저장된 패널 상태가 없을 때 요약 패널을 펼친 채 열지(lg 이상에서만 적용). */
  defaultPanelOpen?: boolean
  /** URL 로 같은 뷰어를 다시 열 수 있는 호출부인지 — false 면 ⋯ "링크 복사"를 숨긴다(이슈 본문 이미지처럼 히스토리 키가 없는 곳). */
  shareable?: boolean
}) {
  const aiAware = useAiPanelAwareDialog({ open: true, size: 'lightbox' })
  // 배치는 폭(모바일 셸 기준과 동일), 제스처는 coarse 포인터로 따로 판정한다(스펙 §3.2 — Task 5).
  const mobile = useIsMobile()
  // 제스처는 폭이 아니라 coarse 포인터 기준 — iPad 가로(≥1024px)는 데스크톱 배치 + 터치 제스처(스펙 §3.2·시안 iPad).
  const coarse = useIsCoarsePointer()
  // 무대(본문 감싸기) — 제스처 리스너·끌기 transform 대상. 콜백 ref 로 state 에 담아 훅이 붙을 시점을 안다.
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  // 모바일 몰입형 화면 — 열린 동안 상태바를 검정으로(스펙 §4.2, 판정 R15). 값은 CSS 가 아닌 브라우저 크롬 색이라 리터럴.
  useThemeColor('#000000', mobile)
  // 바 숨김 — 가로 모드는 기본 숨김(시안 M5), 탭으로 토글(모바일 배치만, 판정 R5).
  // 회전할 때마다 그 방향의 기본값으로 되돌린다 — 렌더 중 상태 갱신(useViewerBundle 의 스냅숏과 같은 수렴 패턴, 이펙트 setState 아님).
  // 주의: "저장된 방향과 다를 때만 기본값" 식의 파생으로 두면 가로→(탭으로 표시)→세로→가로 에서 낡은 '표시'가 되살아난다(Review Focus 4).
  const landscape = useIsLandscape()
  const [bars, setBars] = useState({ landscape, hidden: landscape })
  if (bars.landscape !== landscape) setBars({ landscape, hidden: landscape })
  // 갱신이 반영되는 재렌더 전 한 번은 새 방향 기본값으로 본다.
  // 숨김은 모바일 배치 + 터치(coarse)에서만 — 좁은 창 + 마우스는 다시 보이게 할 탭이 없으므로 바 항상 표시(판정 R5), 데스크톱 배치도 항상 표시.
  const barsHidden = mobile && coarse && (bars.landscape === landscape ? bars.hidden : landscape)
  const topBarRef = useRef<HTMLElement>(null)
  // 아래로 닫기 때 옅어지는 배경 — 루트 배경을 이 레이어로 옮겨 투명도만 바꾼다(하드코딩 색 없이 토큰 유지).
  const [backdrop, setBackdrop] = useState<HTMLDivElement | null>(null)
  // 하단 겹침 바의 실제 높이(px) — "참조된 곳" 띠가 바 위에 얹히면(판정 R11) 고정 4.5rem 으론 본문 끝줄이 가려진다.
  // 측정값을 루트 CSS 변수 --viewer-bottom-chrome 로 내려 ViewerBody 아래 여백이 띠까지 비켜서게 한다(안전영역 포함 값).
  // 바 요소는 콜백 ref 로 상태에 담는다 — Dialog 포털이 내용을 첫 커밋 뒤에 붙여, useRef + 마운트 effect 로는 요소를 놓친다.
  const [actionBarEl, setActionBarEl] = useState<HTMLDivElement | null>(null)
  const [bottomChrome, setBottomChrome] = useState<number | null>(null)
  useEffect(() => {
    if (!actionBarEl) return
    // 띠는 참조 목록이 늦게 도착해 나중에 생기므로 한 번 재지 않고 크기 변화를 계속 따라간다.
    const ro = new ResizeObserver(() => setBottomChrome(actionBarEl.offsetHeight))
    ro.observe(actionBarEl)
    return () => ro.disconnect()
  }, [actionBarEl])
  // 범위 밖 index(목록 재조회 직후 등)에도 죽지 않게 묶음 안으로 맞춘다 — 렌더 시 items 는 비어 있지 않다.
  const idx = Math.min(Math.max(index, 0), items.length - 1)
  const item = items[idx]
  const nav = navState(idx, items.length)
  const kind = resolvePreviewKind(item.mimeType)
  const zoomable = !item.unavailable && (kind === 'IMAGE' || kind === 'PDF')
  const itemKey = item.key
  // 확대·PDF 현재 페이지 — 항목 key 와 함께 들어 다른 항목으로 넘어가면 자동으로 초기화(무시)된다.
  const [zoomState, setZoomState] = useState<{ key: string; value: number }>({ key: itemKey, value: 1 })
  const zoom = zoomState.key === itemKey ? zoomState.value : 1
  const setZoom = (fn: (z: number) => number) => setZoomState({ key: itemKey, value: fn(zoom) })
  // 확대 단계 — 키보드(+/-/0)와 하단 확대 툴바가 같은 규칙을 쓴다(소수 오차는 둘째 자리에서 자른다).
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))
  const zoomReset = () => setZoom(() => 1)
  // 터치 확대 기준점 — 커밋 직후(레이아웃 반영 뒤) 그 점이 제자리에 남도록 스크롤을 맞춘다(판정 R1).
  const zoomAnchor = useRef<{ key: string; from: number; to: number; focus: { x: number; y: number }; left: number; top: number } | null>(null)
  /**
   * 핀치·두 번 탭 확정 — 배율을 바꾸고 기준점과 "바뀌기 전" 스크롤 위치를 기억한다.
   * 왜 전 위치를 미리 재나: 축소하면 내용이 먼저 줄어 브라우저가 scrollLeft/Top 을 새 최대값으로 잘라 버려, 레이아웃 뒤에 읽으면 틀린 기준이 된다.
   */
  const zoomAt = (next: number, focus: { x: number; y: number }) => {
    if (next === zoom) return
    const el = stage?.querySelector<HTMLElement>('[data-hscroll]')
    zoomAnchor.current = { key: itemKey, from: zoom, to: next, focus, left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 }
    setZoom(() => next)
  }
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    // 확정 직후 다른 항목으로 넘어갔으면(배율이 1 로 초기화) 그 항목에 엉뚱한 스크롤을 걸지 않는다.
    if (!a || a.key !== itemKey || a.to !== zoom || !stage) return
    zoomAnchor.current = null
    // 이미지 = 본문 자신, PDF = pdf-document — 둘 다 확대 스크롤 영역 표식(data-hscroll)을 단다(판정 R4).
    const el = stage.querySelector<HTMLElement>('[data-hscroll]')
    if (!el) return
    const s = anchorScroll({ scrollLeft: a.left, scrollTop: a.top, focusX: a.focus.x, focusY: a.focus.y, from: a.from, to: a.to })
    el.scrollLeft = s.left
    el.scrollTop = s.top
  }, [zoom, stage, itemKey])
  const [pdfPage, setPdfPage] = useState<{ key: string; current: number; total: number } | null>(null)
  const onPage = useCallback(
    (current: number, total: number) => setPdfPage({ key: itemKey, current, total }),
    [itemKey],
  )
  const pageLabel = pdfPage && pdfPage.key === itemKey ? `p.${pdfPage.current} / ${pdfPage.total}` : null
  const meta = [item.sizeBytes != null ? formatFileSize(item.sizeBytes) : null, nav.label || null, pageLabel]
    .filter(Boolean)
    .join(' · ')
  // 모바일 상단 2줄째는 순번·쪽만(시안 M1) — 크기는 데스크톱 헤더에만.
  const mobileMeta = [nav.label || null, pageLabel].filter(Boolean).join(' · ')
  // 사이드 패널 — 초기값 = 저장된 마지막 상태, 없으면 호출부 기본값(드라이브는 펼침). 묶음 안에서 넘겨도 유지된다.
  // 모바일 배치는 시트가 본문 절반을 가리므로 항상 닫힌 채 열고, 모바일에서 바꾼 상태는 저장하지 않는다(판정 R10 — 데스크톱 마지막 상태 보존).
  const [panelOpen, setPanelOpen] = useState(() => (getIsMobile() ? false : (readPanelPref() ?? !!defaultPanelOpen)))
  const togglePanel = (open: boolean) => {
    setPanelOpen(open)
    if (getIsMobile()) return
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, open ? '1' : '0')
    } catch {
      // 저장 실패는 무시 — 이번 세션 상태만 유지.
    }
  }
  const summary = useSummaryAvailability(item)
  const showPanel = summary === 'show' && panelOpen
  // 모바일 요약 시트 — 열면 포커스를 시트로, 닫으면 ✨ 칸으로 돌린다(시트가 덮는 액션 바는 그동안 inert).
  // 사용자가 직접 열고 닫을 때만 옮긴다 — 넘김 중 요약 판정(loading↔show)으로 시트가 잠깐 사라졌다 생겨도 포커스를 흔들지 않게.
  const sheetOpen = showPanel && mobile
  const [sheetEl, setSheetEl] = useState<HTMLElement | null>(null)
  const sheetFocus = useRef<'open' | 'close' | null>(null)
  // ☁ 가져오기 — 업로드 첨부(importFileId)에서만 공간 조회를 켠다.
  const importer = useImportToDrive(item.importFileId != null)
  const canImport = item.importFileId != null && importer.ready
  const startImport = () => {
    if (item.importFileId != null) importer.begin(item.importFileId)
  }
  // 현재 항목 blob — 항목 key 와 함께 들어 다른 항목으로 넘기면 자동으로 무시된다(zoomState 와 같은 방식).
  const [source, setSource] = useState<{ key: string; blob: Blob | null; fetches: boolean } | null>(null)
  const cur = source?.key === itemKey ? source : null
  const blob = cur?.blob ?? null
  // 공유할 File — blob 이 바뀔 때만 만든다(canShare 판정·공유 호출에 같은 객체를 쓴다).
  // canShare 판정도 같은 메모에 둔다 — 플랫폼 호출을 매 렌더(끌기·바 토글마다) 반복하지 않게.
  const { file, fileShareable } = useMemo(() => {
    const f = blob ? new File([blob], item.name, { type: item.mimeType || blob.type }) : null
    return { file: f, fileShareable: f != null && canShareFile(f) }
  }, [blob, item.name, item.mimeType])
  // 하단 4칸의 ⤴ 상태(판정 R12). cur 가 아직 없으면 = ViewerBody 첫 보고 전 → fetches 참으로 보고 "받는 중".
  // 미지원 형식은 첫 이펙트에서 곧바로 fetches 거짓이 와서 "공유할 수 없음"이 된다.
  const shareState = resolveShareState({
    supported: canShareApi(),
    fetches: cur?.fetches ?? true,
    blobReady: file != null,
    canShareFile: fileShareable,
  })
  const slots = actionSlots({
    unavailable: !!item.unavailable,
    share: shareState,
    importable: item.importFileId == null ? 'none' : canImport ? 'ready' : 'disabled',
    summary: summary === 'show',
  })
  /**
   * 하단 칸 누름. 공유·iOS 저장은 클릭 핸들러 안에서 await 없이 바로 공유 시트를 연다(제스처 직후 호출 규칙, 스펙 §5.4).
   * 저장 기본은 downloadPath(드라이브 = 감사 로그 경로)로 다시 받는다 — iOS 홈 화면 앱만 메모리 blob 을 공유 시트로(판정 R13).
   * 드라이브는 ☁ 와 같은 가져오기, 요약은 패널(모바일은 시트) 토글.
   */
  const onSlot = (id: SlotId) => {
    if (id === 'share') {
      if (file && fileShareable) void shareFile(file)
    } else if (id === 'save') {
      const method = resolveSaveMethod({ iosStandalone: isIOSDevice() && isStandaloneDisplay(), blobReady: file != null, canShareFile: fileShareable })
      if (method === 'share' && file) void shareFile(file)
      else void downloadViewerItem(item)
    } else if (id === 'drive') startImport()
    else if (id === 'summary') {
      if (getIsMobile()) sheetFocus.current = panelOpen ? 'close' : 'open'
      togglePanel(!panelOpen)
    }
  }
  /** 시트의 요약 닫기 — 포커스를 연 자리(✨ 칸)로 돌려보낸다. */
  const closeSheet = () => {
    sheetFocus.current = 'close'
    togglePanel(false)
  }
  const prevBtn = useRef<HTMLButtonElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)
  // 시트 포커스 이동은 커밋 뒤(effect) — 열 땐 시트가 붙은 뒤, 닫을 땐 액션 바의 inert 가 풀린 뒤라야 focus() 가 먹는다.
  useEffect(() => {
    const intent = sheetFocus.current
    if (intent === 'open' && sheetOpen && sheetEl) {
      sheetEl.focus()
      sheetFocus.current = null
    } else if (intent === 'close' && !sheetOpen) {
      actionBarEl?.querySelector<HTMLElement>('[data-testid="viewer-slot-summary"]')?.focus()
      sheetFocus.current = null
    }
  }, [sheetOpen, sheetEl, actionBarEl])
  /**
   * 탭 = 바 토글(모바일 배치만). 숨기지 않는 경우:
   * - 포커스가 바(‹ › 포함) 안 — inert 로 빠질 요소 안에 포커스가 갇히지 않게(스펙 §5.1).
   * - 요약 시트가 열림 — 시트를 닫으면 ✨ 칸으로 포커스를 돌려야 하는데 그 칸이 숨김(inert)이면 포커스가 길을 잃는다.
   */
  const toggleBars = () => {
    if (sheetOpen) return
    const a = document.activeElement
    const inBars = [topBarRef.current, actionBarEl, prevBtn.current, nextBtn.current].some((el) => el?.contains(a))
    if (!barsHidden && inBars) return
    setBars({ landscape, hidden: !barsHidden })
  }

  // 키 연타 대응 — 부모(URL 훅)는 직전 이동이 렌더에 반영되기 전의 호출을 무시할 수 있다(낡은 위치 스냅숏 방어, 훅은 그대로 둔다).
  // 그래서 "요청했지만 아직 반영 안 된 목표"를 항목 key 로 들고(목록이 바뀌어도 파일 자체를 가리키도록),
  // 현재 항목이 바뀔 때마다 현재 목록에서 다시 해석해 이어서 요청한다(resolvePending). 사라진 목표는 버린다.
  const pendingKey = useRef<string | null>(null)
  // 끝에 닿은 방향 — 눌린 버튼이 사라진 뒤 커밋된 시점에 포커스를 옮기기 위한 표식.
  const focusEdge = useRef<-1 | 1 | null>(null)
  useEffect(() => {
    const r = resolvePending(items, itemKey, pendingKey.current)
    if (r.kind === 'clear') pendingKey.current = null
    else onIndexChange(r.index)
    // onIndexChange 는 호출부가 매 렌더 새로 만들어도 현재 항목이 바뀐 시점에만 보면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey])
  // 끝에 닿았으면 반대쪽 버튼으로 포커스(WCAG 2.4.3) — 버튼이 커밋된 뒤(effect)에 옮기므로 마운트 타이밍에 흔들리지 않는다.
  useEffect(() => {
    const edge = focusEdge.current
    if (edge == null) return
    if (edge === 1 && !nav.hasNext) {
      prevBtn.current?.focus()
      focusEdge.current = null
    } else if (edge === -1 && !nav.hasPrev) {
      nextBtn.current?.focus()
      focusEdge.current = null
    } else if (pendingKey.current == null) focusEdge.current = null
  }, [idx, nav.hasPrev, nav.hasNext])
  /**
   * 이전/다음으로 이동 — 끝에서는 아무것도 하지 않는다(순환 없음).
   * moveFocus=false(제스처 넘김)면 끝에 닿아도 반대쪽 ‹ › 로 포커스를 옮기지 않는다 —
   * 숨김 대상인 ‹ › 안에 포커스가 생기면 다음 탭이 바를 숨기지 못한다(판정 R7). 키보드·버튼 넘김은 기존 규칙(WCAG 2.4.3).
   */
  const go = (dir: -1 | 1, opts?: { moveFocus?: boolean }) => {
    // 기준 위치 = 대기 중인 목표가 현재 목록에 있으면 그 위치, 없으면 현재 위치.
    const pend = pendingKey.current != null ? items.findIndex((i) => i.key === pendingKey.current) : -1
    const next = (pend >= 0 ? pend : idx) + dir
    if (next < 0 || next >= items.length) return
    pendingKey.current = items[next].key
    focusEdge.current = opts?.moveFocus === false ? null : dir
    onIndexChange(next)
  }
  // 연타 보호(pendingKey)를 그대로 타도록 넘김은 go 로 보낸다.
  useViewerGestures(stage, {
    enabled: coarse,
    hasPrev: nav.hasPrev,
    hasNext: nav.hasNext,
    zoom,
    onNav: (dir) => go(dir, { moveFocus: false }),
    backdrop,
    onDismiss: onClose,
    onTap: mobile ? toggleBars : undefined,
    zoomable,
    onZoom: zoomAt,
  })
  // 무대 touch-action — 맞춤 이미지 none, 확대 가능 형식 pan, 그 외 문서는 브라우저 핀치를 살리는 manipulation(판정 R2 + 최종 수정, WCAG 1.4.4).
  const stageTouch = stageTouchAction({ coarse, zoomable, image: kind === 'IMAGE', zoom })
  // 플로팅 확대 툴바 — 핀치·두 번 탭이 있는 "모바일 배치 + 터치"에서만 숨긴다(판정 R8 수정).
  // 좁은 창 + 마우스(1920 화면 반쪽 분할 등)는 제스처가 꺼져 있어 툴바가 유일하게 보이는 확대 수단이다.
  const showZoomBar = zoomable && !(mobile && coarse)

  // 키보드 — 판정은 routeKey(순수), 여기서는 DOM 맥락만 계산한다.
  const onKeyDown = (e: React.KeyboardEvent) => {
    // 포털로 그려진 자식(⋯ 드롭다운·폴더 선택 모달)의 키 이벤트도 React 트리를 따라 여기로 올라온다.
    // 뷰어 DOM 밖에서 난 키는 그 자식의 것이므로(메뉴 안 ←/→ 등) 넘김·확대로 쓰지 않는다.
    if (!e.currentTarget.contains(e.target as Node)) return
    const t = e.target as HTMLElement
    const scroller = t.closest<HTMLElement>('[data-hscroll]')
    const action = routeKey({
      key: e.key,
      ctrlOrMeta: e.ctrlKey || e.metaKey,
      inAiPanel: isInAiPanelDom(t),
      inEditable: t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName),
      // 가로로 실제 스크롤되는 영역(표·확대한 이미지/PDF — 포커스 가능한 data-hscroll) 안이면 ←/→ 는 그 영역이 먼저 쓴다(스펙 §5.2).
      // preventDefault 하지 않으므로 브라우저 기본 동작으로 그 영역이 가로 스크롤된다.
      inHorizontalScroller: !!scroller && scroller.scrollWidth > scroller.clientWidth,
      zoomable,
    })
    if (!action) return
    e.preventDefault()
    if (action === 'prev') go(-1)
    else if (action === 'next') go(1)
    else if (action === 'zoomIn') zoomIn()
    else if (action === 'zoomOut') zoomOut()
    else zoomReset()
  }

  return (
    <Dialog open modal={aiAware.modal} onOpenChange={(o) => !o && onClose()}>
      {aiAware.overlay}
      <DialogContent
        showCloseButton={false}
        // 기본 DialogContent 의 가운데 정렬·max-w·테두리를 덮어 전체 화면으로 — 기본의 w-full 은 w-auto 로 덮는다(width 100% 고정이 inset 을 과제약해 lg:right 패널 비움이 무시됨).
        // — 다크 토큰 강제(.dark).
        className={cn(
          'dark fixed inset-0 top-0 left-0 flex h-[100dvh] w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 text-foreground sm:max-w-none',
          // 모바일: 포털이라 MobileShell 의 --vvh·안전영역 처리 밖 — 직접 적용(스펙 §4.2). 키보드가 없으면 변수 미설정 → 100dvh·0.
          mobile && 'top-[var(--vv-top,0px)] h-[var(--vvh,100dvh)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
          aiAware.contentClassName,
        )}
        // 키보드 열림 다이얼로그 규칙(index.css)에서 이 전체 화면 레이어를 골라 제외하는 표식.
        data-viewer-root=""
        style={mobile && bottomChrome != null ? ({ '--viewer-bottom-chrome': `${bottomChrome}px` } as React.CSSProperties) : undefined}
        {...aiAware.contentProps}
        // 열릴 때 첫 포커스가 다운로드 아이콘 버튼에 가면 툴팁이 바로 뜨고, 첫 Escape 를 툴팁이 먹어
        // 뷰어가 닫히지 않는다 — 포커스는 다이얼로그 자체에 둔다. AI 패널 공존 훅의 처리를 먼저 돌리고, 막지 않았을 때만 바꾼다.
        onOpenAutoFocus={(e) => {
          aiAware.contentProps.onOpenAutoFocus(e)
          if (e.defaultPrevented) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        onKeyDown={onKeyDown}
        data-testid="attachment-viewer"
      >
        {/* 배경 레이어 — 루트는 투명, 배경색은 여기. 아래로 닫기 중 이 레이어만 옅어진다. */}
        <div ref={setBackdrop} aria-hidden data-testid="viewer-backdrop" className="pointer-events-none absolute inset-0 -z-10 bg-background" />
        {/* 모바일: 본문 위에 겹치는 상단 바(✕·이름·순번·⋯) — 데스크톱 헤더 대신. */}
        {mobile && (
          <ViewerMobileTopBar
            item={item}
            meta={mobileMeta}
            hidden={barsHidden}
            barRef={topBarRef}
            more={<ViewerMoreMenu item={item} onImport={canImport ? startImport : undefined} shareable={shareable} />}
          />
        )}
        {!mobile && (
          <header className="flex items-center gap-3 border-b border-border px-4 py-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden>
              <FileTypeIcon mimeType={item.mimeType} className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              {/* 접근 이름은 전체 파일명 + "미리보기"(스펙 §5.2) — 화면에는 가운데 말줄임 제목만 보인다. */}
              <DialogTitle className="truncate text-sm font-medium" title={item.name}>
                <span aria-hidden>{middleEllipsis(item.name, 60)}</span>
                <span className="sr-only">{item.name} 미리보기</span>
              </DialogTitle>
              {/* 크기·순번·쪽 메타를 다이얼로그 설명으로 쓴다. */}
              <DialogDescription className="truncate text-xs text-muted-foreground" data-testid="preview-meta">
                {meta}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!item.unavailable && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="pointer-coarse:size-11"
                        onClick={() => void downloadViewerItem(item)}
                        aria-label="다운로드"
                        data-testid="preview-download"
                      >
                        <Download />
                      </Button>
                    </TooltipTrigger>
                    {/* 툴팁도 body 로 포털되므로 뷰어와 같은 다크 토큰을 쓰게 dark 를 단다. */}
                    <TooltipContent side="bottom" className="dark">
                      다운로드
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {item.importFileId != null && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="pointer-coarse:size-11"
                  aria-label="드라이브로 가져오기"
                  title={importer.unavailable ? '드라이브를 사용할 수 없습니다' : undefined}
                  disabled={!canImport}
                  onClick={startImport}
                >
                  <Cloud />
                </Button>
              )}
              {summary === 'show' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="pointer-coarse:size-11"
                  aria-label="AI 요약"
                  aria-pressed={panelOpen}
                  onClick={() => togglePanel(!panelOpen)}
                >
                  <Sparkles />
                </Button>
              )}
              <ViewerMoreMenu item={item} onImport={canImport ? startImport : undefined} shareable={shareable} />
              <div className="mx-1 h-5 w-px bg-border" aria-hidden />
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label="닫기">
                  <X />
                </Button>
              </DialogClose>
            </div>
          </header>
        )}
        {/* 본문 영역 + 사이드 패널 — lg 미만은 세로로 쌓고, lg 이상은 오른쪽 열. › 는 본문 영역 끝(= 패널 왼쪽)에 붙는다. */}
        <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {/* 항목별로 상태가 초기화되도록 key. */}
            {/* 무대 — 터치 제스처·끌기 이동·핀치 미리보기의 대상. 바·‹ ›·시트는 무대 밖이라 그 위의 터치는 제스처가 아니다. */}
            <div
              ref={setStage}
              data-testid="viewer-stage"
              data-viewer-stage={stageTouch}
              data-zoom={zoom}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <ViewerBody
                key={item.key}
                item={item}
                zoom={zoom}
                onPage={onPage}
                chromeInset={mobile}
                barsHidden={barsHidden}
                onSource={setSource}
              />
            </div>
            {nav.hasPrev && (
              <button
                ref={prevBtn}
                type="button"
                aria-label="이전 파일"
                // 바와 함께 숨김 — inert 로 접근성 트리·Tab 순서에서도 뺀다.
                inert={barsHidden}
                onClick={() => go(-1)}
                className={cn(edgeBtnClass, 'left-3', barsHidden && 'pointer-events-none opacity-0')}
              >
                <ChevronLeft />
              </button>
            )}
            {nav.hasNext && (
              <button
                ref={nextBtn}
                type="button"
                aria-label="다음 파일"
                inert={barsHidden}
                onClick={() => go(1)}
                className={cn(edgeBtnClass, 'right-3', barsHidden && 'pointer-events-none opacity-0')}
              >
                <ChevronRight />
              </button>
            )}
            {/* 모바일 배치 + 터치는 확대를 핀치·두 번 탭으로 하므로 숨긴다(판정 R8 수정 — showZoomBar). */}
            {/* 모바일 배치(좁은 창 + 마우스)에서는 하단 겹침 액션 바 위로 띄운다 — 실측 높이(--viewer-bottom-chrome), 재기 전엔 4칸 바 + 안전영역. */}
            {showZoomBar && (
              <div
                data-testid="viewer-zoom-bar"
                className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-black/60 px-1 text-white"
                style={mobile ? { bottom: 'calc(var(--viewer-bottom-chrome, calc(3.5rem + env(safe-area-inset-bottom))) + 0.75rem)' } : undefined}
              >
                <Button variant="ghost" size="icon" aria-label="축소" disabled={zoom <= ZOOM_MIN} onClick={zoomOut}>
                  <Minus />
                </Button>
                <Button variant="ghost" className="min-w-16 px-2 text-xs" aria-label="맞춤" onClick={zoomReset}>
                  {zoom === 1 ? '폭 맞춤' : `${Math.round(zoom * 100)}%`}
                </Button>
                <Button variant="ghost" size="icon" aria-label="확대" disabled={zoom >= ZOOM_MAX} onClick={zoomIn}>
                  <Plus />
                </Button>
              </div>
            )}
            {/* 스크린리더용 위치 안내 — 넘길 때 파일명과 순번을 읽어 준다. */}
            <p className="sr-only" aria-live="polite" data-testid="viewer-live">
              {items.length > 1 ? `${item.name}, ${items.length}개 중 ${idx + 1}번째` : ''}
            </p>
          </div>
          {showPanel && !mobile && <ViewerSidePanel item={item} onClose={() => togglePanel(false)} />}
        </div>
        {/* ✨ 를 쓸 수 없어도(AI 꺼짐·요약 403) 참조된 곳은 얇은 띠로 보인다 — 비어 있으면 아무것도 그리지 않는다. */}
        {/* 요약 판정 중('loading')에는 띠도 그리지 않는다 — 곧 패널로 옮겨 갈 수 있어 띠→패널 깜빡임을 막는다. */}
        {!mobile && (summary === 'hidden' || summary === 'none') && item.backlinksDriveFileId != null && (
          <div className="max-h-32 shrink-0 overflow-y-auto border-t border-border px-4 py-3">
            <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />
          </div>
        )}
        {/* 모바일 하단 4칸 바 — 참조된 곳 띠는 바 위 같은 겹침 레이어에 얹는다(판정 R11). */}
        {mobile && (
          <ViewerActionBar
            barRef={setActionBarEl}
            slots={slots}
            share={shareState}
            summaryOpen={showPanel}
            hidden={barsHidden}
            covered={sheetOpen}
            onAction={onSlot}
          >
            {(summary === 'hidden' || summary === 'none') && item.backlinksDriveFileId != null && (
              <div className="max-h-24 overflow-y-auto border-b border-border px-4 py-2">
                <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />
              </div>
            )}
          </ViewerActionBar>
        )}
        {/* 모바일 AI 요약 — 본문 아래 쌓는 대신 하단 바 위에 겹치는 반 높이 시트(스펙 §4.2). */}
        {sheetOpen && <ViewerSummarySheet item={item} sheetRef={setSheetEl} onClose={closeSheet} />}
        {/* 폴더 선택 모달 — 뷰어 Dialog 안에 그려 포커스 트랩 안에 둔다. */}
        {importer.picker}
      </DialogContent>
    </Dialog>
  )
}
