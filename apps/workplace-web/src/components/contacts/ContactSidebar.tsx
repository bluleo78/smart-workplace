import { Star, Users } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'

import type { ContactTypeFilter } from '../../types/contact'

// 타입 퀵필터 정의 — 전체/멤버/외부 (즐겨찾기는 후속 이슈)
const TYPE_FILTERS: { value: ContactTypeFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'MEMBER', label: '멤버' },
  { value: 'EXTERNAL', label: '외부' },
]

/**
 * 연락처 2차 사이드바. 검색·타입필터는 URL searchParams(q·type)로 ContactsPage 와 공유.
 * 즐겨찾기 필터·그룹 트리는 후속 이슈 — 비활성 placeholder 로 표시.
 */
export function ContactSidebar() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const type = (params.get('type') as ContactTypeFilter) ?? 'ALL'

  // searchParams 의 특정 키만 갱신(나머지 보존).
  const patch = (next: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v == null || v === '' || (k === 'type' && v === 'ALL')) sp.delete(k)
          else sp.set(k, v)
        }
        return sp
      },
      { replace: true },
    )
  }

  return (
    <aside
      data-testid="contact-sidebar"
      className="hidden w-60 shrink-0 flex-col border-r bg-sidebar p-3 md:flex"
    >
      {/* 검색 */}
      <input
        type="search"
        data-testid="contact-search"
        value={q}
        onChange={(e) => patch({ q: e.target.value })}
        placeholder="이름·이메일 검색"
        className="mb-4 w-full rounded-md border bg-background px-3 py-2 text-sm"
      />

      {/* 타입 퀵필터 */}
      <nav className="space-y-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            data-testid={`contact-filter-${f.value}`}
            aria-current={type === f.value ? 'true' : undefined}
            onClick={() => patch({ type: f.value })}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors',
              type === f.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <Users className="h-4 w-4 shrink-0" />
            {f.label}
          </button>
        ))}
      </nav>

      {/* 후속 이슈 placeholder — 비활성 */}
      <div className="mt-6 space-y-1 opacity-50">
        <div
          aria-disabled="true"
          data-testid="contact-favorites-placeholder"
          className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground"
        >
          <Star className="h-4 w-4 shrink-0" />
          즐겨찾기 <span className="text-xs">(준비 중)</span>
        </div>
        <div className="px-3 pt-2 text-xs font-semibold text-muted-foreground/70">그룹</div>
        <div
          data-testid="contact-grouptree-placeholder"
          className="px-3 py-2 text-xs text-muted-foreground/60"
        >
          그룹 트리 준비 중
        </div>
      </div>
    </aside>
  )
}
