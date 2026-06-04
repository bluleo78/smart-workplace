import { cn } from '@/lib/utils'
import { useUserGroupDetail } from '@/hooks/queries/useUserGroupDetail'
import { useUserGroups } from '@/hooks/queries/useUserGroups'
import type { ContactSelection } from '@/hooks/queries/useContactDetail'
import { findNode, OrgChartView } from './OrgChartView'

interface Props {
  groupId: number
  selected: ContactSelection | null
  onSelect: (sel: ContactSelection) => void
}

/** 그룹 선택 시 우측 뷰. 공유=조직도 서브트리+직속 멤버, 개인=직속 멤버 목록. */
export function GroupContactView({ groupId, selected, onSelect }: Props) {
  const { data: detail, isLoading, isError } = useUserGroupDetail(groupId)
  const { data: tree } = useUserGroups()

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (isError || !detail)
    return <div className="p-6 text-sm text-destructive">그룹을 불러오지 못했습니다</div>

  const sharedSubtree =
    detail.visibility === 'SHARED' && tree ? findNode(tree.shared, groupId) : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="group-contact-view">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-sm font-medium">{detail.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {detail.visibility === 'SHARED' ? '조직도' : '내 그룹'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {sharedSubtree && (
          <div className="mb-4">
            <OrgChartView node={sharedSubtree} />
          </div>
        )}
        <div className="text-xs font-semibold text-muted-foreground">소속 멤버</div>
        {detail.members.length === 0 ? (
          <div data-testid="group-members-empty" className="py-4 text-sm text-muted-foreground">
            소속 멤버가 없습니다
          </div>
        ) : (
          <div className="mt-2 divide-y rounded-md border">
            {detail.members.map((m) => {
              const active = selected?.type === m.targetType && selected?.id === m.targetId
              return (
                <button
                  key={`${m.targetType}-${m.targetId}`}
                  type="button"
                  data-testid={`group-member-${m.targetType}-${m.targetId}`}
                  onClick={() => onSelect({ type: m.targetType, id: m.targetId })}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left',
                    active ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                      m.targetType === 'MEMBER'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {m.targetType === 'MEMBER' ? '멤버' : '외부'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.email || m.organization || m.title || ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
