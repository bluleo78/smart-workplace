import { Star, Users, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select'
import { Button } from '@/components/ui/button'
import { useContactFacets } from '@/hooks/queries/useContactFacets'
import { SELECTED_NAV_CLASS } from '@/lib/selectionStyles'
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
 * 연락처 2차 사이드바 — 「어디를 볼지」만 고른다. 타입 보기·그룹은 URL searchParams(type·group)로 ContactsPage 와 공유.
 * 전체·멤버·외부·즐겨찾기와 조직도·내 그룹은 하나의 「보기」 목록이라 하나를 누르면 그것만 선택된다(WP-976, §B-1).
 * 검색창은 페이지 헤더(ContactsPage)로 옮겼다 — 사이드바는 보기 선택, 검색은 그 보기 안에서 거르기.
 */
export function ContactSidebar() {
  const [params, setParams] = useSearchParams()
  const type = (params.get('type') as ContactTypeFilter) ?? 'ALL'
  const groupParam = params.get('group')
  // 외부 탭일 때만 조직·직책 distinct 옵션 fetch(드롭다운). 그 외 탭은 enabled=false 로 미요청.
  const facets = useContactFacets(type === 'EXTERNAL')
  const orgValue = params.get('organization') ?? ''
  const titleValue = params.get('title') ?? ''
  const hasAdvanced = orgValue !== '' || titleValue !== ''
  // searchParams 의 특정 키만 갱신(나머지 보존).
  // replace: 보기 필터(유형·조직·직책)는 이력에 쌓지 않는다. 그룹 이동은 쌓는다(selectGroup) — 모바일 ‹·시스템 뒤로가 그 전 보기로 돌아오게(WP-977).
  const patch = (next: Record<string, string | null>, replace = true) => {
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev)
        // 필터를 바꾸면 열린 상세(?contact)도 같은 항목에서 닫는다 — 바뀐 목록에 없는 상세가 남지 않게(WP-206).
        sp.delete('contact')
        for (const [k, v] of Object.entries(next)) {
          if (v == null || v === '' || (k === 'type' && v === 'ALL')) sp.delete(k)
          else sp.set(k, v)
        }
        return sp
      },
      { replace },
    )
  }

  // 정수 검증을 거친 그룹 ID(비정수는 null) — ContactsPage 와 동일 기준이라야 선택 표시와 그룹 뷰 표시가 일치한다.
  const selectedGroupId = parseGroupId(groupParam)
  // 그룹으로 이동하면 이전 보기(타입·외부 고급 필터)는 저절로 풀린다 — 범위 칩 × 로 그룹을 풀었을 때
  // 예전 「외부 + 조직」 필터가 되살아나지 않게 함께 지운다. 검색어(q)는 보기를 바꿔도 이어 간다(WP-976).
  // 이미 보고 있는 그룹을 다시 누르면 아무것도 바꾸지 않는다 — patch 가 ?contact 를 지워 열린 상세가 닫히지 않게(WP-976).
  // 다른 그룹으로 옮길 때만 이력에 쌓고, 그룹 해제는 replace 라 ‹ 가 같은 화면으로 돌아오지 않는다(WP-977).
  const selectGroup = (id: number | null) => {
    if (id != null && id === selectedGroupId) return
    patch({ group: id == null ? null : String(id), type: null, organization: null, title: null }, id == null)
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
        {/* 타입 퀵필터 — ALL/MEMBER/EXTERNAL/FAVORITE */}
        <nav className="space-y-1">
        {TYPE_FILTERS.map((f) => {
          // 조직도·내 그룹을 고른 동안엔 그룹이 현재 보기라 퀵필터는 어느 것도 현재 항목이 아니다(WP-898).
          // 잠그지는 않는다 — 누르면 그 보기로 바로 이동하고 그룹 선택은 저절로 풀린다(WP-976).
          const current = selectedGroupId == null && type === f.value
          return (
          <button
            key={f.value}
            type="button"
            data-testid={`contact-filter-${f.value}`}
            aria-current={current ? 'page' : undefined}
            // 모바일 시트에서 고르면 시트를 닫아 바뀐 목록을 보여 준다(WP-578). 단 '외부'는 시트 안에
            // 조직·직책 필터가 이어 나타나므로 둔다(조직/직책 필터도 시트 안에서 이어 고르므로 닫지 않는다).
            data-sheet-dismiss={f.value === 'EXTERNAL' ? undefined : true}
            // 그룹을 보고 있었다면 그 선택을 함께 푼다(group: null) — 하나를 누르면 그것만 선택(§B-1).
            onClick={() =>
              patch(
                f.value === 'EXTERNAL'
                  ? { type: f.value, group: null }
                  : { type: f.value, group: null, organization: null, title: null },
              )
            }
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
              current
                ? SELECTED_NAV_CLASS
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
          )
        })}
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
