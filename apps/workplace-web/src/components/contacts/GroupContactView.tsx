import { Search } from 'lucide-react'

import { LoadErrorState } from '@/components/LoadErrorState'
import { Button } from '@/components/ui/button'
import type { ContactSelection } from '@/hooks/queries/useContactDetail'
import { useGroupMemberSearch } from '@/hooks/queries/useGroupMemberSearch'
import { useUserGroupDetail } from '@/hooks/queries/useUserGroupDetail'
import { SELECTED_SURFACE_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import type { UserGroupMemberHit } from '@/types/userGroup'

interface Props {
  groupId: number
  selected: ContactSelection | null
  onSelect: (sel: ContactSelection) => void
  /** 헤더 검색어(URL q). 있으면 이 그룹과 하위 조직 전체에서 찾는다(WP-1000 — 예전엔 직속 구성원만, WP-976). */
  search?: string
  /** 「전체에서 찾기」 — 그룹 범위를 풀고 같은 검색어로 전체 연락처를 찾는다(범위 칩 × 와 같은 동작). */
  onSearchAll?: () => void
}

/**
 * 그룹 선택 시 우측 뷰 — 소속 멤버.
 * 예전엔 고른 그룹의 서브트리를 테두리 카드(OrgChartView)로 다시 그렸다 — 왼쪽 트리와 겹치고 관리 버튼이 hover 전용이라 없앴다(WP-978).
 * 하위 조직은 왼쪽 트리가 보이고, 관리(하위 추가·수정·삭제)는 트리 행의 ⋯ 로 옮겼다.
 * 검색하면 하위 조직 구성원까지 서버에서 찾고, 하위 조직 사람은 행에 소속 경로를 붙인다(WP-1000).
 */
export function GroupContactView({ groupId, selected, onSelect, search = '', onSearchAll }: Props) {
  const { data: detail, isLoading, isError } = useUserGroupDetail(groupId)
  const searching = search.trim() !== ''
  const found = useGroupMemberSearch(groupId, search)

  if (isLoading || (searching && found.isLoading)) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (isError || !detail) return <div className="p-6 text-sm text-destructive">그룹을 불러오지 못했습니다</div>
  // 검색만 실패 — 그룹은 불러왔으니 그룹 오류로 보이지 않고 검색을 다시 하게 한다. 전체에서 찾기도 남긴다.
  if (searching && !found.data)
    return (
      <div className="p-6">
        <LoadErrorState variant="inline" title="구성원을 찾지 못했습니다" queries={[found]} testId="group-search-error" />
      </div>
    )

  // 행 = 검색 결과(하위 조직이면 서버가 준 소속 경로). 검색하지 않을 때는 직속 멤버만이라 경로가 없다.
  const rows: UserGroupMemberHit[] = searching ? found.data! : detail.members.map((m) => ({ ...m, groupId, groupPath: [] }))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="group-contact-view">
      {/* 그룹 이름·조직도 배지 줄은 두지 않는다 — 위치는 페이지 헤더의 브레드크럼(데스크톱)·「‹ 이름」(모바일)이 보인다(WP-977, §B-1). */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-xs font-semibold text-muted-foreground">
          {searching ? `하위 조직 포함 검색 결과 ${rows.length}명` : '소속 멤버'}
        </div>
        {rows.length === 0 ? (
          <div data-testid="group-members-empty" className="py-4 text-sm text-muted-foreground">
            {searching ? `하위 조직까지 찾았지만 「${search.trim()}」 검색 결과가 없습니다` : '소속 멤버가 없습니다'}
          </div>
        ) : (
          <div className="mt-2 divide-y rounded-md border">
            {rows.map((m) => {
              const active = selected?.type === m.targetType && selected?.id === m.targetId
              const sub = m.email || m.organization || m.title || ''
              return (
                <button
                  key={`${m.targetType}-${m.targetId}`}
                  type="button"
                  data-testid={`group-member-${m.targetType}-${m.targetId}`}
                  aria-pressed={active}
                  onClick={() => onSelect({ type: m.targetType, id: m.targetId })}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left',
                    // ContactsPage 연락처 행과 같은 규칙 — 보조 줄이 굵어지지 않게 막대+배경만.
                    active ? SELECTED_SURFACE_CLASS : 'hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                      m.targetType === 'MEMBER'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {m.targetType === 'MEMBER' ? '멤버' : '외부'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    {/* 하위 조직 사람은 소속 경로를 앞에 — 「그 그룹에 없는 사람」처럼 보이지 않게(WP-1000). */}
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.groupPath.length > 0 && (
                        <span data-testid={`group-member-path-${m.targetType}-${m.targetId}`}>
                          {m.groupPath.join(' › ')}
                          {sub && ' · '}
                        </span>
                      )}
                      {sub}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {/* 검색 결과 아래 범위 해제 — 그룹 밖에 있는 사람을 찾으려면 같은 검색어로 전체에서 다시 찾는다(§B-1 「범위」). */}
        {searching && onSearchAll && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="group-search-all"
            onClick={onSearchAll}
            className="mt-3 text-muted-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            전체에서 「{search.trim()}」 찾기
          </Button>
        )}
      </div>
    </div>
  )
}
