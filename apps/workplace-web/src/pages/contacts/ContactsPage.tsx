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
import type { ContactSummary, ContactTypeFilter } from '../../types/contact'

// 한 줄 목록 항목 — 멤버/외부 배지 + 이름·보조정보.
function ContactRow({
  c,
  active,
  onSelect,
}: {
  c: ContactSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`contact-row-${c.type}-${c.id}`}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
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
  )
}

/** 통합 연락처 목록 + 마스터-디테일. 검색·타입은 URL searchParams 와 공유(ContactSidebar). */
export function ContactsPage() {
  const [params] = useSearchParams()
  const search = params.get('q') ?? ''
  const type = ((params.get('type') as ContactTypeFilter) ?? 'ALL') as ContactTypeFilter
  const groupParam = params.get('group')
  const groupId = parseGroupId(groupParam)

  const [selected, setSelected] = useState<ContactSelection | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // 그룹·타입·검색 등 목록 필터 전환 시 이전 선택(상세 패널) 초기화 — 좁은 화면에서 사이드바 필터를 바꿔도 상세가 남지 않도록.
  useEffect(() => {
    setSelected(null)
  }, [groupId, search, type])
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useContacts(
    search,
    type,
  )

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
              <GroupContactView groupId={groupId} selected={selected} onSelect={setSelected} />
            ) : isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
            ) : isError ? (
              <div className="p-6 text-sm text-destructive">목록을 불러오지 못했습니다</div>
            ) : items.length === 0 ? (
              <div data-testid="contact-list-empty" className="p-6 text-sm text-muted-foreground">
                연락처가 없습니다
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
