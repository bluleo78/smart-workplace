import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { driveApi } from '../../api/drive'
import { formatFileSize } from '../../lib/formatters'
import { resolvePreviewKind } from '../../lib/previewKind'
import { cn } from '../../lib/utils'
import { isInAiPanelDom } from '../ai/aiPanelSurface'
import { useAiPanelAwareDialog } from '../ai/useAiPanelAwareDialog'
import { FileTypeIcon } from '../drive/FileTypeIcon'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import type { ViewerItem } from './types'
import { ViewerBody } from './ViewerBody'
import { ViewerBacklinks, ViewerSummaryCard } from './ViewerDriveExtras'
import { middleEllipsis, navState, routeKey } from './viewerNav'

/** 확대 단계(25%)와 범위. */
const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

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
  // defaultPanelOpen 은 사이드 패널(후속 태스크)에서 쓴다 — 인터페이스만 먼저 고정.
  onClose,
}: {
  items: ViewerItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  defaultPanelOpen?: boolean
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
  const [pdfPage, setPdfPage] = useState<{ key: string; current: number; total: number } | null>(null)
  const onPage = useCallback(
    (current: number, total: number) => setPdfPage({ key: itemKey, current, total }),
    [itemKey],
  )
  const pageLabel = pdfPage && pdfPage.key === itemKey ? `p.${pdfPage.current} / ${pdfPage.total}` : null
  const meta = [item.sizeBytes != null ? formatFileSize(item.sizeBytes) : null, nav.label || null, pageLabel]
    .filter(Boolean)
    .join(' · ')
  const prevBtn = useRef<HTMLButtonElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)

  // 키 연타 대응 — 부모(URL 훅)는 직전 이동이 렌더에 반영되기 전의 호출을 무시할 수 있다(낡은 위치 스냅숏 방어).
  // 그래서 "요청했지만 아직 반영 안 된 목표 위치"를 ref 로 들고, 부모 index 가 바뀔 때 남은 목표가 있으면 이어서 요청한다.
  const pendingIdx = useRef<number | null>(null)
  useEffect(() => {
    const target = pendingIdx.current
    if (target == null) return
    if (target === idx) pendingIdx.current = null
    else onIndexChange(target)
    // onIndexChange 는 호출부가 매 렌더 새로 만들어도 idx 변화 시점에만 보면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])
  /** 이전/다음으로 이동 — 끝에서는 아무것도 하지 않는다(순환 없음). */
  const go = (dir: -1 | 1) => {
    const next = (pendingIdx.current ?? idx) + dir
    if (next < 0 || next >= items.length) return
    pendingIdx.current = next
    onIndexChange(next)
    // 끝에 닿아 누른 버튼이 사라지면 포커스가 body(또는 Radix 트랩이 되돌린 다이얼로그)로 떨어지므로
    // 끝에 닿은 방향이면 항상 반대쪽 버튼으로 옮긴다(WCAG 2.4.3). 반대쪽 버튼은 묶음이 2건 이상이면 늘 있다.
    requestAnimationFrame(() => {
      const gone = dir === 1 ? next === items.length - 1 : next === 0
      if (gone) (dir === 1 ? prevBtn : nextBtn).current?.focus()
    })
  }

  // 키보드 — 판정은 routeKey(순수), 여기서는 DOM 맥락만 계산한다.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    const scroller = t.closest<HTMLElement>('[data-hscroll]')
    const action = routeKey({
      key: e.key,
      ctrlOrMeta: e.ctrlKey || e.metaKey,
      inAiPanel: isInAiPanelDom(t),
      inEditable: t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName),
      // 가로로 실제 스크롤되는 표 안이면 ←/→ 는 표가 먼저 쓴다(스펙 §5.2).
      inHorizontalScroller: !!scroller && scroller.scrollWidth > scroller.clientWidth,
      zoomable,
    })
    if (!action) return
    e.preventDefault()
    if (action === 'prev') go(-1)
    else if (action === 'next') go(1)
    else if (action === 'zoomIn') setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))
    else if (action === 'zoomOut') setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))
    else setZoom(() => 1)
  }
  // 헤더 다운로드는 경로만 있으면 된다 — blob 훅을 하나 더 만들지 않는다.
  const download = () => driveApi.downloadByPath(item.downloadPath, item.name)

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
            <DialogTitle className="truncate text-sm font-medium" title={item.name}>
              {middleEllipsis(item.name, 60)}
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground" data-testid="preview-meta">
              {meta}
            </p>
          </div>
          <DialogDescription className="sr-only">{item.name} 미리보기</DialogDescription>
          <div className="flex shrink-0 items-center gap-1">
            {!item.unavailable && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void download()}
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
            {/* ✨·☁·⋯ 는 후속 태스크 */}
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="닫기">
                <X />
              </Button>
            </DialogClose>
          </div>
        </header>
        {/* 과도기: 드라이브 요약 카드·참조된 곳을 기존 모달처럼 본문 위·아래에 둔다(후속 태스크에서 사이드 패널로 이동). */}
        <ViewerSummaryCard driveFileId={item.summaryDriveFileId} />
        <div className="relative flex min-h-0 flex-1 flex-col">
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
              <Button variant="ghost" size="icon" aria-label="축소" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}>
                <Minus />
              </Button>
              <Button variant="ghost" className="min-w-16 px-2 text-xs" aria-label="맞춤" onClick={() => setZoom(() => 1)}>
                {zoom === 1 ? '폭 맞춤' : `${Math.round(zoom * 100)}%`}
              </Button>
              <Button variant="ghost" size="icon" aria-label="확대" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}>
                <Plus />
              </Button>
            </div>
          )}
          {/* 스크린리더용 위치 안내 — 넘길 때 파일명과 순번을 읽어 준다. */}
          <p className="sr-only" aria-live="polite" data-testid="viewer-live">
            {items.length > 1 ? `${item.name}, ${items.length}개 중 ${idx + 1}번째` : ''}
          </p>
        </div>
        <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />
      </DialogContent>
    </Dialog>
  )
}
