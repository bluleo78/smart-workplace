// 백링크 패널 — 이 페이지를 참조(멘션)하는 다른 위키 페이지 목록을 에디터 하단에 노출한다.
// 빈 배열/로딩/에러는 절제 처리(패널 숨김 또는 무노출)해 본문 편집을 방해하지 않는다.
// 디자인 시스템 시맨틱 토큰만 사용(hex/임의색 금지) — 기존 사이드/카드 패턴 재사용.

import { Link2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useWikiBacklinks } from '../../hooks/queries/useWikiBacklinks'

/** 이 페이지를 참조하는 위키 페이지(백링크) 패널. items 가 없으면 렌더하지 않는다. */
export function WikiBacklinksPanel({ pageId }: { pageId: number }) {
  const { data, isLoading, isError } = useWikiBacklinks(pageId)
  const items = data?.items ?? []

  // 로딩/에러/빈 결과는 패널 자체를 숨긴다 — 참조가 있는 페이지에서만 절제적으로 노출.
  if (isLoading || isError || items.length === 0) return null

  return (
    <section className="mt-8 border-t pt-4" data-testid="wiki-backlinks-panel">
      {/* 헤더 — 참조 출처임을 명시. 아이콘 + 라벨. */}
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />이 페이지를 참조하는 곳
      </h2>
      <ul className="space-y-1">
        {items.map((b) => (
          <li key={b.pageId}>
            {/* 출처 페이지로 이동 — 각 백링크 자신의 spaceId/pageId 사용(현재 페이지 아님). */}
            <Link
              to={`/wiki/spaces/${b.spaceId}/pages/${b.pageId}`}
              data-testid={`wiki-backlink-${b.pageId}`}
              className="flex items-baseline gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="truncate font-medium text-foreground">{b.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{b.spaceName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
