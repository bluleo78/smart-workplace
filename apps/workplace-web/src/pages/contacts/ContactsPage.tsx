import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ContactDetailPanel } from '../../components/contacts/ContactDetailPanel'
import { ExternalContactFormDialog } from '../../components/contacts/ExternalContactFormDialog'
import { GroupContactView } from '../../components/contacts/GroupContactView'
import { parseGroupId } from '../../components/contacts/groupTree.helpers'
import type { ContactSelection } from '../../hooks/queries/useContactDetail'
import { useContacts } from '../../hooks/queries/useContacts'
import { useToggleFavorite } from '../../hooks/queries/useFavoriteMutations'
import type { ContactSummary, ContactTypeFilter } from '../../types/contact'

// 한 줄 목록 항목 — 멤버/외부 배지 + 이름·보조정보 + 호버 시 즐겨찾기 별 버튼.
// 중첩 button 방지를 위해 행 컨테이너는 div, 선택 클릭은 inner button, 별은 형제 button.
function ContactRow({
  c,
  active,
  onSelect,
}: {
  c: ContactSummary
  active: boolean
  onSelect: () => void
}) {
  const toggle = useToggleFavorite()
  return (
    <div
      data-testid={`contact-row-${c.type}-${c.id}`}
      className={cn(
        'group flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
            c.type === 'MEMBER' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {c.type === 'MEMBER' ? '멤버' : '외부'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{c.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {c.email || c.organization || c.title || ''}
          </span>
        </span>
      </button>
      {/* 즐겨찾기 토글 — hover 시 표시, 이미 즐겨찾기면 항상 표시 */}
      <button
        type="button"
        data-testid={`contact-fav-${c.type}-${c.id}`}
        aria-label={c.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-pressed={c.isFavorite}
        onClick={() => toggle.mutate({ targetType: c.type, targetId: c.id, isFavorite: c.isFavorite })}
        className={cn(
          'shrink-0 rounded p-1 transition-opacity',
          c.isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Star className={cn('h-4 w-4', c.isFavorite && 'fill-yellow-400 text-yellow-400')} />
      </button>
    </div>
  )
}

/** 통합 연락처 목록 + 마스터-디테일. 검색·타입은 URL searchParams 와 공유(ContactSidebar). */
export function ContactsPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const type = ((params.get('type') as ContactTypeFilter) ?? 'ALL') as ContactTypeFilter
  const organization = params.get('organization') ?? ''
  const title = params.get('title') ?? ''
  const groupParam = params.get('group')
  const groupId = parseGroupId(groupParam)

  const [selected, setSelected] = useState<ContactSelection | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // 보던 조직도 그룹이 삭제되면 URL group 파라미터 제거 → 통합 목록 복귀.
  const clearGroupSelection = () => {
    const next = new URLSearchParams(params)
    next.delete('group')
    setParams(next, { replace: true })
  }

  // 그룹·타입·검색 등 목록 필터 전환 시 이전 선택(상세 패널) 초기화 — 좁은 화면에서 사이드바 필터를 바꿔도 상세가 남지 않도록.
  useEffect(() => {
    setSelected(null)
  }, [groupId, search, type, organization, title])
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useContacts(search, type, organization, title)

  const items = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        {/* 전폭 헤더 — 연락처 제목 + 새 외부 연락처 버튼(그룹·일반 공통) */}
        <PageHeader
          title="연락처"
          actions={
            <Button size="sm" data-testid="contact-create" onClick={() => setCreateOpen(true)}>
              새 외부 연락처
            </Button>
          }
        />
        <div className="flex min-h-0 flex-1">
          {/* 목록 (마스터) — 좁은 화면 + 선택 시 숨김 */}
          <div
            className={cn(
              'flex min-w-0 flex-1 flex-col border-r',
              selected != null && 'hidden lg:flex',
            )}
            data-testid="contact-list"
          >
            {groupId != null ? (
              <GroupContactView
                groupId={groupId}
                selected={selected}
                onSelect={setSelected}
                onGroupDeleted={clearGroupSelection}
              />
            ) : isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
            ) : isError ? (
              <div className="p-6 text-center">
                <p className="text-sm text-destructive mb-2">목록을 불러오지 못했습니다</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
              </div>
            ) : items.length === 0 ? (
              // 빈 상태 — 즐겨찾기 모드일 때 전용 메시지, 그 외 기본 메시지
              <div data-testid="contact-empty" className="p-8 text-center text-sm text-muted-foreground">
                {type === 'FAVORITE' ? '즐겨찾기한 연락처가 없습니다' : '연락처가 없습니다'}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {items.map((c) => (
                  <ContactRow
                    key={`${c.type}-${c.id}`}
                    c={c}
                    active={selected?.type === c.type && selected?.id === c.id}
                    onSelect={() => setSelected({ type: c.type, id: c.id })}
                  />
                ))}
                {hasNextPage && (
                  <button
                    type="button"
                    data-testid="contact-load-more"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="w-full p-3 text-sm text-muted-foreground hover:bg-accent/50"
                  >
                    {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 상세 (디테일) — 좁은 화면은 선택 시 전체폭 */}
          <div
            className={cn(
              'min-w-0 flex-1',
              selected == null ? 'hidden lg:block' : 'flex flex-col lg:block',
            )}
            data-testid="contact-detail"
          >
            {/* 좁은 화면 뒤로가기 — lg 이상에서는 숨김 */}
            <button
              type="button"
              data-testid="contact-back"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 border-b px-4 py-2 text-sm text-primary lg:hidden"
            >
              ‹ 목록
            </button>
            <ContactDetailPanel selected={selected} onDeleted={() => setSelected(null)} />
          </div>
        </div>
      </div>

      {/* 새 외부 연락처 생성 모달 */}
      <ExternalContactFormDialog open={createOpen} onOpenChange={setCreateOpen} contact={null} />
    </>
  )
}
