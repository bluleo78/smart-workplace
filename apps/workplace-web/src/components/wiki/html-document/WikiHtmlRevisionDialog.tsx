import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { useRestoreWikiRevision, useWikiRevision, useWikiRevisions } from '../../../hooks/queries/useWikiRevisions'
import { wikiKeys } from '../../../hooks/queries/wikiKeys'
import type { WikiPageDetail, WikiRevisionItem, WikiRevisionList } from '../../../types/wiki'
import { NoteScriptFrame, WikiHtmlBlockScopeProvider, WikiHtmlScriptBar } from '../wikiHtmlBlockSecurity'
import { groupRevisionsByDay, revisionEditorsLabel, revisionTime, revisionVersionLabel } from '../wikiRevisionFormat'

/** 목록 한 줄 — 지금 판 또는 저장된 판. */
type Entry = { kind: 'current'; editedAt: string } | { kind: 'revision'; item: WikiRevisionItem }

/** 목록 응답 → 날짜 묶음(「현재 버전」 + 저장된 판 최신순). 아직 없으면 빈 목록. */
function groupEntries(data: WikiRevisionList | undefined) {
  if (!data) return []
  const entries: Entry[] = [
    { kind: 'current', editedAt: data.current.editedAt },
    ...data.items.map((item): Entry => ({ kind: 'revision', item })),
  ]
  return groupRevisionsByDay(entries, (e) => (e.kind === 'current' ? e.editedAt : e.item.editedAt))
}

/**
 * 「HTML 문서」 버전 기록(WP-1307) — 저장할 때마다 남은 이전 원본을 고르고 격리 iframe 으로 미리 본다.
 * 노트 버전 기록(WikiRevisionLayer — 편집기 문서·차이 표시)과 달리 원본 HTML 한 덩어리라 목록 + 미리보기 대화상자로 둔다.
 * 「이 버전으로 되돌리기」(편집자만)는 서버 복원을 부르고, 동기화 서버가 없으므로 응답으로 열린 페이지 캐시를 바로 바꾼다.
 * restoreBlockedReason 이 있으면(누가 편집 중 — WP-1308, 서버도 409 로 막는다) 되돌리기를 막고 그 이유를 단추 위 title 로 보인다.
 */
export function WikiHtmlRevisionDialog({
  open,
  onOpenChange,
  page,
  canRestore,
  restoreBlockedReason,
  spaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  page: Pick<WikiPageDetail, 'id' | 'html' | 'title'>
  canRestore: boolean
  restoreBlockedReason?: string
  spaceId: number
}) {
  const qc = useQueryClient()
  // 고른 판 — null 이면 「현재 버전」(지금 원본).
  const [selected, setSelected] = useState<number | null>(null)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setSelected(null)
  }
  const list = useWikiRevisions(page.id, { enabled: open })
  const detail = useWikiRevision(page.id, selected)
  const restore = useRestoreWikiRevision(page.id)
  // 줄·날짜 묶음은 목록이 새로 올 때만 다시 만든다.
  const groups = useMemo(() => groupEntries(list.data), [list.data])
  const selectedItem = selected == null ? null : (list.data?.items.find((i) => i.version === selected) ?? null)
  // 미리볼 원본 — 현재 버전은 열린 페이지 원본, 고른 판은 그 판 원본(노트였던 판·옛 판은 null).
  const previewHtml = selected == null ? (page.html ?? '') : detail.data ? (detail.data.html ?? null) : undefined

  const onRestore = () => {
    if (selected == null || !selectedItem) return
    const label = revisionVersionLabel(selectedItem.editedAt)
    restore.mutate(selected, {
      onSuccess: (data) => {
        // 원본은 동기화 서버가 아니라 REST 가 원본이다 — 응답으로 열린 페이지를 바로 바꾸고 제목도 트리에 반영한다.
        qc.setQueryData<WikiPageDetail>(wikiKeys.page(data.id), data)
        void qc.invalidateQueries({ queryKey: wikiKeys.tree(spaceId) })
        toast.success(`${label}으로 되돌렸습니다`)
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-5xl" data-testid="wiki-html-revision-dialog">
        <DialogHeader>
          <DialogTitle>버전 기록</DialogTitle>
          <DialogDescription>저장할 때마다 이전 원본이 남습니다. 판을 고르면 그 원본을 미리 봅니다.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[14rem_1fr]">
          {/* 목록 — 날짜로 묶고 맨 위는 현재 버전. */}
          <div className="max-h-48 overflow-y-auto rounded-md border md:max-h-none" data-testid="wiki-html-revision-list">
            {list.isError ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">버전 기록을 불러오지 못했어요</p>
            ) : !list.data ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.label} aria-label={g.label}>
                  <h3 className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{g.label}</h3>
                  <ul>
                    {g.entries.map((e) => {
                      const version = e.kind === 'current' ? null : e.item.version
                      const isSelected = selected === version
                      return (
                        <li key={version ?? 'current'}>
                          <button
                            type="button"
                            aria-current={isSelected ? 'true' : undefined}
                            data-testid={version == null ? 'wiki-html-revision-current' : `wiki-html-revision-${version}`}
                            onClick={() => setSelected(version)}
                            className={cn('flex w-full flex-col px-3 py-1.5 text-left hover:bg-accent', isSelected && SELECTED_ROW_CLASS)}
                          >
                            <span className="text-sm">{e.kind === 'current' ? '현재 버전' : revisionTime(e.item.editedAt)}</span>
                            {e.kind === 'revision' && e.item.editors.length > 0 && (
                              <span className="text-xs text-muted-foreground">{revisionEditorsLabel(e.item.editors)}</span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
          {/* 미리보기 — 문서 그대로 격리 iframe 에서(스크립트는 스위치로 켠다). */}
          <div className="flex min-h-[50dvh] flex-col overflow-hidden rounded-md border">
            {previewHtml === undefined ? (
              <Skeleton className="m-3 h-40" />
            ) : previewHtml === null ? (
              <p className="p-4 text-sm text-muted-foreground" data-testid="wiki-html-revision-empty">
                이 판에는 HTML 원본이 없습니다
              </p>
            ) : (
              // 스크립트는 기본 멈춤(WP-1290) — 지난 판은 서버가 점검하지 않아 스위치만 둔다. 지금 문서의 노트 범위와 섞이지 않게 따로 감싼다.
              <WikiHtmlBlockScopeProvider scope={{ pageId: page.id, noCheck: true }}>
                <WikiHtmlScriptBar className="m-2" />
                <NoteScriptFrame
                  html={previewHtml}
                  title={`${page.title || '제목 없음'} 버전 미리보기`}
                  data-testid="wiki-html-revision-frame"
                  className="h-full min-h-[50dvh] w-full flex-1 border-0 bg-background"
                />
              </WikiHtmlBlockScopeProvider>
            )}
          </div>
        </div>
        {canRestore && selected != null && (
          <div className="flex justify-end">
            {/* 막힌 단추는 포인터를 받지 않아 title 이 뜨지 않으므로 감싼 칸에 단다. */}
            <span title={restoreBlockedReason} data-testid="wiki-html-revision-restore-wrap">
              <Button
                type="button"
                onClick={onRestore}
                disabled={restore.isPending || previewHtml == null || restoreBlockedReason != null}
                data-testid="wiki-html-revision-restore"
              >
                이 버전으로 되돌리기
              </Button>
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
