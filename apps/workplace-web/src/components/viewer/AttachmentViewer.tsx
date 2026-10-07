import { ChevronLeft, ChevronRight, Cloud, Download, Minus, Plus, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getIsMobile } from '../../hooks/useIsMobile'
import { formatFileSize } from '../../lib/formatters'
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
import { ViewerBacklinks } from './ViewerBacklinks'
import { ViewerBody } from './ViewerBody'
import { ViewerMoreMenu } from './ViewerMoreMenu'
import { middleEllipsis, navState, resolvePending, routeKey } from './viewerNav'
import { ViewerSidePanel } from './ViewerSidePanel'

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
  const [pdfPage, setPdfPage] = useState<{ key: string; current: number; total: number } | null>(null)
  const onPage = useCallback(
    (current: number, total: number) => setPdfPage({ key: itemKey, current, total }),
    [itemKey],
  )
  const pageLabel = pdfPage && pdfPage.key === itemKey ? `p.${pdfPage.current} / ${pdfPage.total}` : null
  const meta = [item.sizeBytes != null ? formatFileSize(item.sizeBytes) : null, nav.label || null, pageLabel]
    .filter(Boolean)
    .join(' · ')
  // 사이드 패널 — 초기값 = 저장된 마지막 상태, 없으면 호출부 기본값(드라이브는 펼침, 단 lg 이상에서만). 묶음 안에서 넘겨도 유지된다.
  // 좁은 화면(모바일 폭 — 앱 공용 기준 MOBILE_MEDIA_QUERY)에선 패널이 본문 아래로 쌓여 본문을 가리므로, 사용자가 직접 연 적이 없으면 접힌 채 연다.
  const [panelOpen, setPanelOpen] = useState(() => readPanelPref() ?? (!!defaultPanelOpen && !getIsMobile()))
  const togglePanel = (open: boolean) => {
    setPanelOpen(open)
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, open ? '1' : '0')
    } catch {
      // 저장 실패는 무시 — 이번 세션 상태만 유지.
    }
  }
  const summary = useSummaryAvailability(item)
  const showPanel = summary === 'show' && panelOpen
  // ☁ 가져오기 — 업로드 첨부(importFileId)에서만 공간 조회를 켠다.
  const importer = useImportToDrive(item.importFileId != null)
  const canImport = item.importFileId != null && importer.ready
  const startImport = () => {
    if (item.importFileId != null) importer.begin(item.importFileId)
  }
  const prevBtn = useRef<HTMLButtonElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)

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
  /** 이전/다음으로 이동 — 끝에서는 아무것도 하지 않는다(순환 없음). */
  const go = (dir: -1 | 1) => {
    // 기준 위치 = 대기 중인 목표가 현재 목록에 있으면 그 위치, 없으면 현재 위치.
    const pend = pendingKey.current != null ? items.findIndex((i) => i.key === pendingKey.current) : -1
    const next = (pend >= 0 ? pend : idx) + dir
    if (next < 0 || next >= items.length) return
    pendingKey.current = items[next].key
    focusEdge.current = dir
    onIndexChange(next)
  }

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
          'dark fixed inset-0 top-0 left-0 flex h-[100dvh] w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 text-foreground sm:max-w-none',
          aiAware.contentClassName,
        )}
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
                      onClick={() => void downloadViewerItem(item)}
                      aria-label="다운로드"
                      data-testid="preview-download"
                    >
                      <Download />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">다운로드</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {item.importFileId != null && (
              <Button
                variant="ghost"
                size="icon"
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
              <Button variant="ghost" size="icon" aria-label="닫기">
                <X />
              </Button>
            </DialogClose>
          </div>
        </header>
        {/* 본문 영역 + 사이드 패널 — lg 미만은 세로로 쌓고, lg 이상은 오른쪽 열. › 는 본문 영역 끝(= 패널 왼쪽)에 붙는다. */}
        <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {/* 항목별로 상태가 초기화되도록 key. */}
            <ViewerBody key={item.key} item={item} zoom={zoom} onPage={onPage} />
            {nav.hasPrev && (
              <button ref={prevBtn} type="button" aria-label="이전 파일" onClick={() => go(-1)} className={cn(edgeBtnClass, 'left-3')}>
                <ChevronLeft />
              </button>
            )}
            {nav.hasNext && (
              <button ref={nextBtn} type="button" aria-label="다음 파일" onClick={() => go(1)} className={cn(edgeBtnClass, 'right-3')}>
                <ChevronRight />
              </button>
            )}
            {zoomable && (
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-black/60 px-1 text-white">
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
          {showPanel && <ViewerSidePanel item={item} onClose={() => togglePanel(false)} />}
        </div>
        {/* ✨ 를 쓸 수 없어도(AI 꺼짐·요약 403) 참조된 곳은 얇은 띠로 보인다 — 비어 있으면 아무것도 그리지 않는다. */}
        {/* 요약 판정 중('loading')에는 띠도 그리지 않는다 — 곧 패널로 옮겨 갈 수 있어 띠→패널 깜빡임을 막는다. */}
        {(summary === 'hidden' || summary === 'none') && item.backlinksDriveFileId != null && (
          <div className="max-h-32 shrink-0 overflow-y-auto border-t border-border px-4 py-3">
            <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />
          </div>
        )}
        {/* 폴더 선택 모달 — 뷰어 Dialog 안에 그려 포커스 트랩 안에 둔다. */}
        {importer.picker}
      </DialogContent>
    </Dialog>
  )
}
