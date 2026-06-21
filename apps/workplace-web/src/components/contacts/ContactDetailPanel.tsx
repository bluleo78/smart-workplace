import { Star } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { cn } from '@/lib/utils'

import type { ContactSelection } from '../../hooks/queries/useContactDetail'
import { useContactDetail } from '../../hooks/queries/useContactDetail'
import { useDeleteExternalContact } from '../../hooks/queries/useExternalContactMutations'
import { useToggleFavorite } from '../../hooks/queries/useFavoriteMutations'
import type { ExternalContactDetail, MemberDetail } from '../../types/contact'
import { ExternalContactFormDialog } from './ExternalContactFormDialog'

// 라벨-값 한 줄. 값이 없으면 '-'.
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value || '-'}</span>
    </div>
  )
}

/** 선택된 연락처 상세 패널. 멤버=프로필+그룹(읽기전용), 외부=연락 필드 + editable 시 수정/삭제. */
export function ContactDetailPanel({
  selected,
  onDeleted,
}: {
  selected: ContactSelection | null
  onDeleted?: () => void
}) {
  const { data, isLoading, isError, refetch } = useContactDetail(selected)
  const [editOpen, setEditOpen] = useState(false)
  const del = useDeleteExternalContact()
  // 즐겨찾기 토글 — 멤버/외부 공통으로 사용
  const toggle = useToggleFavorite()

  if (!selected) {
    return (
      <div
        data-testid="contact-detail-empty"
        className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground"
      >
        목록에서 연락처를 선택하세요
      </div>
    )
  }
  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  }
  if (isError || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-2">연락처를 찾을 수 없습니다</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
      </div>
    )
  }

  if (selected.type === 'MEMBER') {
    const m = data as MemberDetail
    return (
      <div data-testid="contact-detail-member" className="p-6">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-lg font-semibold">{m.name}</h2>
          {/* 멤버 즐겨찾기 토글 버튼 */}
          <button
            type="button"
            data-testid="contact-detail-fav"
            aria-label={m.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            aria-pressed={m.isFavorite}
            onClick={() => toggle.mutate({ targetType: selected.type, targetId: selected.id, isFavorite: m.isFavorite })}
            className="rounded p-1 hover:bg-accent"
          >
            <Star className={cn('h-5 w-5', m.isFavorite && 'fill-yellow-400 text-yellow-400')} />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">멤버 · @{m.username}</p>
        <Row label="이메일" value={m.email} />
        <Row label="직책" value={m.title} />
        <Row label="소속 그룹" value={m.groups.length ? m.groups.join(', ') : null} />
      </div>
    )
  }

  const e = data as ExternalContactDetail
  return (
    <div data-testid="contact-detail-external" className="p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{e.name}</h2>
            {/* 외부 연락처 즐겨찾기 토글 버튼 */}
            <button
              type="button"
              data-testid="contact-detail-fav"
              aria-label={e.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              aria-pressed={e.isFavorite}
              onClick={() => toggle.mutate({ targetType: selected.type, targetId: selected.id, isFavorite: e.isFavorite })}
              className="rounded p-1 hover:bg-accent"
            >
              <Star className={cn('h-5 w-5', e.isFavorite && 'fill-yellow-400 text-yellow-400')} />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            외부 연락처 · {e.visibility === 'SHARED' ? '공유' : '개인'}
          </p>
        </div>
        {e.editable && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="contact-edit"
              onClick={() => setEditOpen(true)}
            >
              수정
            </Button>
            <DeleteConfirmDialog
              entityName="연락처"
              itemName={e.name}
              onConfirm={() => del.mutate(e.id, { onSuccess: () => onDeleted?.() })}
              trigger={
                <Button variant="destructive" size="sm" data-testid="contact-delete">
                  삭제
                </Button>
              }
            />
          </div>
        )}
      </div>
      <Row label="이메일" value={e.email} />
      <Row label="전화" value={e.phone} />
      <Row label="소속" value={e.organization} />
      <Row label="직책" value={e.title} />
      <Row label="메모" value={e.notes} />

      <ExternalContactFormDialog open={editOpen} onOpenChange={setEditOpen} contact={e} />
    </div>
  )
}
