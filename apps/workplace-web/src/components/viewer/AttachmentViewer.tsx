import { Download, X } from 'lucide-react'

import { driveApi } from '../../api/drive'
import { formatFileSize } from '../../lib/formatters'
import { cn } from '../../lib/utils'
import { useAiPanelAwareDialog } from '../ai/useAiPanelAwareDialog'
import { FileTypeIcon } from '../drive/FileTypeIcon'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import type { ViewerItem } from './types'
import { ViewerBody } from './ViewerBody'
import { ViewerBacklinks, ViewerSummaryCard } from './ViewerDriveExtras'
import { middleEllipsis, navState } from './viewerNav'

/**
 * 통합 첨부 뷰어(WP-276) — 다크 라이트박스. 묶음(items) 안에서 넘겨 본다(넘김 UI 는 후속).
 * Radix Dialog 위에 그려 포커스 트랩·Esc·포커스 복귀를 그대로 쓰고,
 * useAiPanelAwareDialog 로 앱 AI 사이드 패널과 공존한다(WP-54) — side 모드면 패널 폭만큼 비켜선다.
 * 열림·현재 항목은 호출부가 useHistoryParam 으로 들고 있다(뒤로가기 = 닫기).
 */
export function AttachmentViewer({
  items,
  index,
  // onIndexChange·defaultPanelOpen 은 넘김·사이드 패널(후속 태스크)에서 쓴다 — 인터페이스만 먼저 고정.
  onClose,
}: {
  items: ViewerItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  defaultPanelOpen?: boolean
}) {
  const aiAware = useAiPanelAwareDialog({ open: true, size: 'lightbox' })
  const item = items[index]
  const nav = navState(index, items.length)
  const meta = [item.sizeBytes != null ? formatFileSize(item.sizeBytes) : null, nav.label || null]
    .filter(Boolean)
    .join(' · ')
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
          <ViewerBody key={item.key} item={item} />
          {/* ‹ › 는 후속 태스크 */}
        </div>
        <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />
      </DialogContent>
    </Dialog>
  )
}
