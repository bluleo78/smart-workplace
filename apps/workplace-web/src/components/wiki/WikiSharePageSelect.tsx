// WP-579 공유 링크 화면의 휴대폰용 페이지 선택 — 왼쪽 트리 자리가 없는 좁은 화면에서 공유된 하위 페이지로 옮긴다.
// 외부 보기(WikiPublicSharePage)와 로그인 공유 화면(WikiSharePage)이 같은 모양으로 쓴다.

import { cn } from '@/lib/utils'

import type { WikiPageSummary } from '../../types/wiki'
import { flattenShareTree } from './wikiShareTree'

type SharePageOption = Pick<WikiPageSummary, 'id' | 'parentId' | 'title' | 'position'>

/**
 * 「공유된 페이지」 선택 상자 — 트리 깊이는 앞 공백으로 보인다. 보일지(휴대폰에서만)는 부르는 쪽이 정한다(className 으로 md:hidden 등).
 * activeId 가 목록에 없으면(하위 밖으로 옮겨진 페이지) 브라우저가 첫 항목을 보인다.
 */
export function WikiSharePageSelect({
  pages,
  activeId,
  onSelect,
  className,
}: {
  pages: SharePageOption[]
  activeId: number | null | undefined
  onSelect: (pageId: number) => void
  className?: string
}) {
  return (
    <div className={cn('shrink-0 border-b px-4 py-2', className)}>
      <select
        aria-label="공유된 페이지"
        value={activeId ?? undefined}
        onChange={(e) => onSelect(Number(e.target.value))}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {flattenShareTree(pages).map((r) => (
          <option key={r.page.id} value={r.page.id}>
            {'  '.repeat(r.depth)}
            {r.page.title || '제목 없음'}
          </option>
        ))}
      </select>
    </div>
  )
}
