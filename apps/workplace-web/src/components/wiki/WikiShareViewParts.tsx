// WP-579 공유 링크 화면 조각 — 로그인 공유 화면(WikiSharePage)과 외부 보기(WikiPublicSharePage)가 함께 쓴다.

import { Link2 } from 'lucide-react'

import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import type { WikiPageSummary } from '../../types/wiki'
import { flattenShareTree } from './wikiShareTree'

type ShareTreePage = Pick<WikiPageSummary, 'id' | 'parentId' | 'position' | 'title'>

/**
 * 공유된 하위 트리 목록 — 하위 포함 공유일 때만 그린다. 드래그·추가·삭제 없이 페이지를 옮겨 다니기만 한다.
 * 감싸는 자리(제목·너비·테두리·모바일 숨김)와 testid 는 화면마다 달라 부르는 쪽이 정한다.
 */
export function WikiShareTreeNav({
  pages,
  activeId,
  onOpen,
  className,
  testId,
}: {
  pages: ShareTreePage[]
  activeId: number | null | undefined
  onOpen: (id: number) => void
  className?: string
  testId?: string
}) {
  return (
    <nav className={cn('overflow-y-auto px-1 py-2', className)} data-testid={testId}>
      {flattenShareTree(pages).map((r) => (
        <button
          key={r.page.id}
          type="button"
          onClick={() => onOpen(r.page.id)}
          aria-current={r.page.id === activeId ? 'page' : undefined}
          style={{ paddingLeft: 8 + r.depth * 16 }}
          className={cn(
            'flex w-full items-center rounded py-1 pr-2 text-left text-sm hover:bg-accent',
            r.page.id === activeId && SELECTED_ROW_CLASS,
          )}
        >
          <span className="truncate">{r.page.title || '제목 없음'}</span>
        </button>
      ))}
    </nav>
  )
}

/**
 * 일시적으로 못 불러옴(5xx·네트워크) — 링크는 살아 있을 수 있어 「더 이상 열리지 않습니다」 대신 다시 시도를 둔다.
 * 공유 화면과 외부 보기가 같은 문구를 쓴다.
 */
export function WikiShareLoadError({ onRetry, testId }: { onRetry: () => void; testId?: string }) {
  return (
    <div data-testid={testId} className="flex flex-1 flex-col">
      <ResourceErrorState
        icon={Link2}
        title="문서를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        actionLabel="다시 시도"
        onAction={onRetry}
      />
    </div>
  )
}
