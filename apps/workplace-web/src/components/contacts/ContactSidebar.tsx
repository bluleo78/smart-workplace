import { Star, Users } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { cn } from '@/lib/utils'

import type { ContactTypeFilter } from '../../types/contact'
import { GroupTree } from './GroupTree'
import { parseGroupId } from './groupTree.helpers'

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
  const groupParam = params.get('group')
  // 정수 검증을 거친 그룹 ID(비정수는 null) — ContactsPage 와 동일 기준이라야 검색·필터 잠금과 그룹 뷰 표시가 일치한다.
  const selectedGroupId = parseGroupId(groupParam)
  const selectGroup = (id: number | null) =>
    patch({ group: id == null ? null : String(id) })

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
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "연락처" 앱임을 명시 */}
      <div className={sidebarTitleClass}>
        <Users className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        연락처
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 검색 */}
        <input
          type="search"
          data-testid="contact-search"
          value={q}
          onChange={(e) => patch({ q: e.target.value })}
          disabled={selectedGroupId != null}
          placeholder="이름·이메일 검색"
          className="mb-4 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        />

        {/* 타입 퀵필터 */}
        <nav className="space-y-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            data-testid={`contact-filter-${f.value}`}
            disabled={selectedGroupId != null}
            aria-current={type === f.value ? 'true' : undefined}
            onClick={() => patch({ type: f.value })}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50',
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

        {/* 후속 이슈 placeholder — 즐겨찾기(#94)는 유지 */}
        <div className="mt-6 space-y-1 opacity-50">
          <div
            aria-disabled="true"
            data-testid="contact-favorites-placeholder"
            className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground"
          >
            <Star className="h-4 w-4 shrink-0" />
            즐겨찾기 <span className="text-xs">(준비 중)</span>
          </div>
        </div>
        {/* #93 그룹 트리 */}
        <GroupTree selectedId={selectedGroupId} onSelect={selectGroup} />
      </div>
    </aside>
  )
}
