import { Copy, Link2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatListTime } from '@/lib/formatters'

import { useWikiSharedPages } from '../../hooks/queries/useWikiShare'
import { copyShareLink, shareScopeLabel } from './wikiShare'

/**
 * 스페이스에서 링크로 공유 중인 페이지 목록(WP-579 2순위) — 무엇이 스페이스 밖에 열려 있는지 한곳에서 확인한다.
 * 줄을 누르면 그 페이지로 가고, 설정은 페이지의 「공유 중」 버튼에서 바꾼다.
 * 링크 복사는 서버가 토큰을 준 줄에만 둔다 — 스페이스 읽기 전용(VIEWER) 멤버에겐 token 이 null 이다(편집 링크로 권한을 얻지 못하게).
 */
export function WikiSharedPagesDialog({
  open,
  onOpenChange,
  spaceId,
  spaceName,
  onOpenPage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  spaceId: number
  spaceName: string
  onOpenPage: (pageId: number) => void
}) {
  const list = useWikiSharedPages(spaceId, open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="wiki-shared-pages-dialog">
        <DialogHeader>
          <DialogTitle>공유 중인 페이지</DialogTitle>
          <DialogDescription>{spaceName}에서 링크로 공유하고 있는 페이지입니다.</DialogDescription>
        </DialogHeader>
        {list.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : list.isError ? (
          <p className="py-6 text-center text-sm text-destructive">목록을 불러오지 못했습니다.</p>
        ) : list.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">공유 중인 페이지가 없습니다.</p>
        ) : (
          <ul className="-mx-2 max-h-[60vh] overflow-y-auto" data-testid="wiki-shared-pages-list">
            {list.data.map((item) => (
              <li key={item.pageId} className="flex items-center gap-1 rounded-md pr-1 hover:bg-accent">
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenPage(item.pageId)
                  }}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 text-left"
                >
                  <Link2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title || '제목 없음'}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {shareScopeLabel(item.audience, item.permission, item.peopleCount, item.groupCount)}
                      {item.includeChildren && ' · 하위 페이지 포함'}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    <span className="block">{item.createdBy.name}</span>
                    <span className="block tabular-nums">{formatListTime(item.updatedAt)}</span>
                  </span>
                </button>
                {/* 줄 전체가 버튼이라 그 안에 두면 버튼이 중첩된다 — 옆에 따로 둔다. */}
                {item.token != null && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label={`${item.title || '제목 없음'} 링크 복사`}
                    onClick={() => void copyShareLink(item.token as string)}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
