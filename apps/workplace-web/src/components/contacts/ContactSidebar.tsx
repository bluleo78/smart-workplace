import { Star, Users, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useContactFacets } from '@/hooks/queries/useContactFacets'
import { cn } from '@/lib/utils'

import type { ContactTypeFilter } from '../../types/contact'
import { GroupTree } from './GroupTree'
import { parseGroupId } from './groupTree.helpers'

// 타입 퀵필터 정의 — 전체/멤버/외부/즐겨찾기
const TYPE_FILTERS: { value: ContactTypeFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'MEMBER', label: '멤버' },
  { value: 'EXTERNAL', label: '외부' },
  { value: 'FAVORITE', label: '즐겨찾기' },
]

/**
 * 연락처 2차 사이드바. 검색·타입필터는 URL searchParams(q·type)로 ContactsPage 와 공유.
 * 그룹 트리는 후속 이슈.
 */
export function ContactSidebar() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const type = (params.get('type') as ContactTypeFilter) ?? 'ALL'
  const groupParam = params.get('group')
  // 외부 탭일 때만 조직·직책 distinct 옵션 fetch(드롭다운). 그 외 탭은 enabled=false 로 미요청.
  const facets = useContactFacets(type === 'EXTERNAL')
  const orgValue = params.get('organization') ?? ''
  const titleValue = params.get('title') ?? ''
  const hasAdvanced = orgValue !== '' || titleValue !== ''
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

        {/* 타입 퀵필터 — ALL/MEMBER/EXTERNAL/FAVORITE */}
        <nav className="space-y-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            data-testid={`contact-filter-${f.value}`}
            disabled={selectedGroupId != null}
            aria-current={type === f.value ? 'true' : undefined}
            onClick={() =>
              patch(
                f.value === 'EXTERNAL'
                  ? { type: f.value }
                  : { type: f.value, organization: null, title: null },
              )
            }
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50',
              type === f.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            {/* FAVORITE 모드는 별 아이콘, 나머지는 그룹 아이콘 */}
            {f.value === 'FAVORITE' ? (
              <Star className="h-4 w-4 shrink-0" />
            ) : (
              <Users className="h-4 w-4 shrink-0" />
            )}
            {f.label}
          </button>
        ))}
      </nav>

        {/* #329 외부 전용 고급 필터 — 조직·직책 distinct 드롭다운. 외부 탭 + 그룹 미선택일 때만. */}
        {type === 'EXTERNAL' && selectedGroupId == null && (
          <div className="mt-4 space-y-3" data-testid="contact-advanced-filter">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              고급 필터
            </p>

            {/* 조직 */}
            <div className="space-y-1">
              <label htmlFor="contact-filter-org" className="text-xs text-muted-foreground">조직</label>
              <Select
                value={orgValue || '__all__'}
                onValueChange={(v) => patch({ organization: v === '__all__' ? null : v })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  id="contact-filter-org"
                  data-testid="contact-filter-org"
                  aria-label="조직 필터"
                >
                  <SelectValue placeholder="조직 전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" data-testid="contact-filter-org-all">
                    조직 전체
                  </SelectItem>
                  {facets.data?.organizations.map((o) => (
                    <SelectItem key={o} value={o} data-testid={`contact-filter-org-${o}`}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 직책 */}
            <div className="space-y-1">
              <label htmlFor="contact-filter-title" className="text-xs text-muted-foreground">직책</label>
              <Select
                value={titleValue || '__all__'}
                onValueChange={(v) => patch({ title: v === '__all__' ? null : v })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  id="contact-filter-title"
                  data-testid="contact-filter-title"
                  aria-label="직책 필터"
                >
                  <SelectValue placeholder="직책 전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" data-testid="contact-filter-title-all">
                    직책 전체
                  </SelectItem>
                  {facets.data?.titles.map((t) => (
                    <SelectItem key={t} value={t} data-testid={`contact-filter-title-${t}`}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 초기화 — 활성 필터가 있을 때만 노출(ghost) */}
            {hasAdvanced && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="contact-filter-reset"
                onClick={() => patch({ organization: null, title: null })}
                className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
              >
                <X className="mr-1 h-3 w-3" />
                필터 초기화
              </Button>
            )}
          </div>
        )}

        {/* #93 그룹 트리 */}
        <GroupTree selectedId={selectedGroupId} onSelect={selectGroup} />
      </div>
    </aside>
  )
}
