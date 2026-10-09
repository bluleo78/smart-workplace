import { ExternalLink, Pencil, Unlink } from 'lucide-react'

import { MOBILE_SHEET_ROW, MobileSheetShell } from '@/components/mobile/MobileSheetShell'
import { cn } from '@/lib/utils'

import { displayLinkHref, openableHref } from './wikiLinkUrl'

/**
 * 링크 시트(WP-312, 터치 셸) — 편집 중 링크를 누르면 바텀시트로 주소(줄바꿈해 전부)와 열기·고치기·해제를 보인다.
 * hover·수정키 클릭이 없는 터치에서 링크를 여는 길이다(데스크톱은 WikiLinkBubble). 행은 44px(MOBILE_SHEET_ROW).
 * canModify=false 면 열기만 보인다.
 */
export function WikiLinkActionSheet({
  href,
  open,
  canModify,
  onClose,
  onEdit,
  onUnlink,
}: {
  href: string
  open: boolean
  canModify: boolean
  onClose: () => void
  onEdit: () => void
  onUnlink: () => void
}) {
  const openable = openableHref(href)
  return (
    <MobileSheetShell open={open} onClose={onClose} title="링크" description="링크 열기·고치기·해제" testId="wiki-link-sheet">
      {/* 긴 주소도 잘리지 않게 아무 곳에서나 줄바꿈 — 시트 폭을 넘겨 가로 스크롤이 생기지 않게. */}
      <p
        data-testid="wiki-link-sheet-url"
        className="px-4 pb-2 font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]"
      >
        {displayLinkHref(href)}
      </p>
      <div className="border-t py-1">
        {openable && (
          // 새 탭 + opener 차단 — 보기 전용 렌더와 같은 속성. 누르면 시트를 닫는다.
          <a
            href={openable}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wiki-link-sheet-open"
            onClick={onClose}
            className={cn(MOBILE_SHEET_ROW, 'text-foreground [&_svg]:text-muted-foreground')}
          >
            <ExternalLink aria-hidden="true" />
            링크 열기
          </a>
        )}
        {canModify && (
          <>
            <button
              type="button"
              data-testid="wiki-link-sheet-edit"
              onClick={() => {
                onClose()
                onEdit()
              }}
              className={cn(MOBILE_SHEET_ROW, 'text-foreground [&_svg]:text-muted-foreground')}
            >
              <Pencil aria-hidden="true" />
              링크 고치기
            </button>
            <button
              type="button"
              data-testid="wiki-link-sheet-unlink"
              onClick={() => {
                onClose()
                onUnlink()
              }}
              className={cn(MOBILE_SHEET_ROW, 'text-destructive')}
            >
              <Unlink aria-hidden="true" />
              링크 해제
            </button>
          </>
        )}
      </div>
    </MobileSheetShell>
  )
}
