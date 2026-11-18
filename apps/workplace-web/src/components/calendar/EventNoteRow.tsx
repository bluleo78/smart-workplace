// 일정의 「회의록」 줄(WP-1701) — 일정 창(편집 폼)·상세 보기가 함께 쓴다.
// 연결이 없으면 「노트 연결」 단추, 있으면 카드(제목·공간 · 고친 사람 · 고친 때, 「열기」, X). 볼 수 없는 노트는 「볼 수 없는 노트」만.
// 읽기만 하는 사람(editable=false)은 카드만 보고, 연결이 없으면 줄째 숨긴다. X 는 연결만 풀고 노트는 지우지 않는다.
// 「회의록 만들기」(WP-1702)는 onCreate 를 넘긴 곳(일정 창)에서만 「노트 연결」 앞에 그린다. 새 일정에서 만들기로 정해 둔 회의록은
// 「저장하면 만듦」 카드로 보인다.
import { Link2, NotebookText, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { wikiSpacePagePath } from '@/lib/appUrl'
import { noteMetaLine } from '@/lib/eventNote'
import type { EventNoteRef } from '@/types/calendar'
import type { WikiSearchResult } from '@/types/wiki'

import { NoteSummary } from './NoteSummary'

interface EventNoteRowProps {
  /** 이은 노트 — null/undefined 는 연결 없음(조회 중 포함) */
  note: EventNoteRef | null | undefined
  /** 새 일정에서 저장 전 고른 노트 — 카드에 「저장하면 연결」을 단다 */
  pending?: WikiSearchResult | null
  /** 새 일정에서 저장 전 만들기로 정해 둔 회의록 — 제목과 `공간 › 상위` 를 받아 카드에 「저장하면 만듦」을 단다(WP-1702) */
  pendingCreate?: { title: string; locationLabel: string } | null
  /** 잇고 끊을 수 있는 사람 */
  editable: boolean
  onPick?: () => void
  onUnlink?: () => void
  /** 「회의록 만들기」 — 넘기지 않으면 그리지 않는다(일정 창만 넘긴다, WP-1702) */
  onCreate?: () => void
}

/** 카드 한 장 — 아이콘 · 두 줄(각각 한 줄 말줄임) · 「열기」 · X. */
function NoteCard({
  title,
  meta,
  badge,
  href,
  onUnlink,
}: {
  title: string
  meta?: string
  badge?: string
  href?: string
  onUnlink?: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2" data-testid="event-note-card">
      <NoteSummary title={title} meta={[meta, badge].filter(Boolean).join(' · ')} />
      {href && (
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link to={href} data-testid="event-note-open">
            열기
          </Link>
        </Button>
      )}
      {onUnlink && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="회의록 연결 해제"
          data-testid="event-note-unlink"
          onClick={onUnlink}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

export function EventNoteRow({ note, pending, pendingCreate, editable, onPick, onUnlink, onCreate }: EventNoteRowProps) {
  // 읽기만 하는 사람에겐 X 를 주지 않는다(WP-1701)
  const unlink = editable ? onUnlink : undefined
  let content: ReactNode
  if (pendingCreate) {
    content = (
      <NoteCard title={pendingCreate.title} meta={pendingCreate.locationLabel} badge="저장하면 만듦" onUnlink={unlink} />
    )
  } else if (pending) {
    content = (
      <NoteCard
        title={pending.title}
        meta={noteMetaLine(pending)}
        badge="저장하면 연결"
        onUnlink={unlink}
      />
    )
  } else if (note?.restricted) {
    content = <NoteCard title="볼 수 없는 노트" onUnlink={unlink} />
  } else if (note) {
    content = (
      <NoteCard
        title={note.title ?? ''}
        meta={noteMetaLine(note)}
        href={note.spaceId != null && note.pageId != null ? wikiSpacePagePath(note.spaceId, note.pageId) : undefined}
        onUnlink={unlink}
      />
    )
  } else if (editable) {
    content = (
      // 시안 순서 — 「＋ 회의록 만들기」 다음 「노트 연결」(WP-1702)
      <div className="flex flex-wrap gap-2">
        {onCreate && (
          <Button type="button" variant="outline" size="sm" data-testid="event-note-create" onClick={onCreate}>
            <Plus aria-hidden="true" />
            회의록 만들기
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" data-testid="event-note-pick" onClick={onPick}>
          <Link2 aria-hidden="true" />
          노트 연결
        </Button>
      </div>
    )
  } else {
    // 읽기만 하는 사람 + 연결 없음 — 줄째 숨긴다
    return null
  }

  return (
    <div className="flex items-start gap-3" data-testid="event-note-row">
      <NotebookText className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">회의록</span>
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  )
}
