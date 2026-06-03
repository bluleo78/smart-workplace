import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ContactDetailPanel } from '../../components/contacts/ContactDetailPanel'
import { ExternalContactFormDialog } from '../../components/contacts/ExternalContactFormDialog'
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

  const [selected, setSelected] = useState<ContactSelection | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useContacts(
    search,
    type,
  )

  const items = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <div className="flex h-full min-h-0">
        {/* 목록 (마스터) */}
        <div className="flex min-w-0 flex-1 flex-col border-r" data-testid="contact-list">
          {/* 툴바 — 새 외부 연락처 버튼 */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium text-muted-foreground">연락처</span>
            <Button size="sm" data-testid="contact-create" onClick={() => setCreateOpen(true)}>
              새 외부 연락처
            </Button>
          </div>
          {isLoading ? (
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

        {/* 상세 (디테일) */}
        <div className="hidden min-w-0 flex-1 lg:block" data-testid="contact-detail">
          <ContactDetailPanel selected={selected} onDeleted={() => setSelected(null)} />
        </div>
      </div>

      {/* 새 외부 연락처 생성 모달 */}
      <ExternalContactFormDialog open={createOpen} onOpenChange={setCreateOpen} contact={null} />
    </>
  )
}
