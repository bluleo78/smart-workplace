// 연결된 일정 패널 — 이 노트가 회의록으로 이어진 캘린더 일정(회차)을 에디터 하단에 노출한다(WP-1703).
// 로딩/에러(읽을 수 없는 노트 404 포함)/빈 목록은 패널을 숨겨 본문 편집을 방해하지 않는다.
// 디자인 시스템 시맨틱 토큰만 사용(hex/임의색 금지) — WikiBacklinksPanel 과 같은 결.

import { CalendarDays } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useNoteLinkedEvents } from '../../hooks/queries/useNoteLinkedEvents'
import { linkedEventHref, linkedEventMeta } from '../../lib/noteLinkedEvent'

/** 이 노트에 이어진 일정 패널. 구분선·위 여백은 이 패널이 갖고, 아래 백링크 패널은 wrapper 가 정리한다. */
export function WikiLinkedEventsPanel({ pageId }: { pageId: number }) {
  // 로딩·오류 중엔 data 가 없어 빈 목록과 같다 — 셋 다 패널을 숨긴다.
  const items = useNoteLinkedEvents(pageId).data?.items ?? []
  if (items.length === 0) return null

  return (
    <section className="mt-8 border-t pt-4" data-testid="wiki-linked-events-panel">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />연결된 일정
      </h2>
      <ul className="space-y-1">
        {items.map((e) => (
          <li key={`${e.eventId}-${e.occurrenceDate ?? 'single'}`}>
            {/* min-w-0 + truncate — 390px 에서 긴 제목이 가로로 넘치지 않게 제목만 줄이고 보조 글은 유지 */}
            <Link
              to={linkedEventHref(e)}
              data-testid={`wiki-linked-event-${e.eventId}-${e.occurrenceDate ?? 'single'}`}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="min-w-0 max-w-full truncate font-medium text-foreground">{e.title}</span>
              <span className="text-xs text-muted-foreground">{linkedEventMeta(e)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
