// 임시보관함 목록(WP-577) — 받은편지함 목록 열 자리에 그린다. 행을 누르면 상세 패널이 아니라 작성창이 그 내용으로 열린다.
// 삭제는 행 hover·모바일 스와이프 대신 ⋯ 메뉴에 둔다(데스크톱·터치 같은 방법). 지운 뒤 토스트 「되돌리기」로 다시 만든다.
import { FilePen, PenLine, Trash2 } from 'lucide-react'

import { EmptyState } from '@/components/layout/EmptyState'
import { DropdownMenuItem } from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { draftRecipientsLabel } from '@/lib/mailDraftCompose'
import { formatReceivedAt } from '@/lib/mailListTime'
import { mailSubjectText } from '@/lib/mailSubject'
import { cn } from '@/lib/utils'

import { useDeleteMailDraft, useMailDrafts, useOpenMailDraft } from '../../hooks/queries/useMailDrafts'
import type { MailDraftSummary } from '../../types/mailDraft'
import { MailListRowShell } from './MailListRowShell'

/** 임시보관함 한 행 — 「임시저장」 표식 · 받는사람 · 첨부 · 저장 시각 · ⋯ / 제목 / 미리보기. */
function DraftRow({
  d,
  onOpen,
  onDelete,
}: {
  d: MailDraftSummary
  onOpen: () => void
  onDelete: () => void
}) {
  const recipients = draftRecipientsLabel(d.to)
  return (
    <MailListRowShell
      testId={`mail-draft-row-${d.id}`}
      onOpen={onOpen}
      openTestId={`mail-draft-row-open-${d.id}`}
      openLabel={`임시저장 ${recipients || '받는사람 없음'} ${mailSubjectText(d.subject)}`}
      lead={
        <>
          {/* 임시저장 표식 — 보낸 메일·받은 메일과 한눈에 구분되게 빨간 글자(Gmail 의 Draft 표식과 같은 역할). */}
          <span className="shrink-0 text-xs font-semibold text-destructive-text">임시저장</span>
          <span className={cn('min-w-0 flex-1 truncate text-sm', !recipients && 'text-muted-foreground')}>
            {recipients || '받는사람 없음'}
          </span>
        </>
      }
      attachmentCount={d.attachmentCount}
      attachmentTestId={`mail-draft-attachment-${d.id}`}
      trailing={<span className="shrink-0 text-xs text-muted-foreground">{formatReceivedAt(d.updatedAt)}</span>}
      menuTestId={`mail-draft-menu-${d.id}`}
      menuLabel="임시저장 메뉴"
      menuItems={
        <>
          <DropdownMenuItem data-testid={`mail-draft-open-${d.id}`} onSelect={onOpen}>
            <PenLine /> 이어 쓰기
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" data-testid={`mail-draft-delete-${d.id}`} onSelect={onDelete}>
            <Trash2 /> 삭제
          </DropdownMenuItem>
        </>
      }
      subject={d.subject}
      preview={d.preview}
    />
  )
}

/** 임시보관함 목록 열 — 로딩·오류·빈 상태·행 목록. */
export function MailDraftsList({ accountId }: { accountId: number }) {
  const { data, isLoading, isError, refetch } = useMailDrafts(accountId)
  const openDraft = useOpenMailDraft()
  const del = useDeleteMailDraft(accountId)

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="mb-2 text-sm text-destructive">임시보관함을 불러오지 못했습니다</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          다시 시도
        </Button>
      </div>
    )
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        testId="mail-drafts-empty"
        className="gap-2 py-16"
        icon={FilePen}
        title="임시저장한 메일이 없어요"
        description="쓰다가 닫은 메일은 여기에 저장돼요."
      />
    )
  }
  return (
    <div data-testid="mail-drafts-list" className="flex-1 overflow-y-auto">
      {data.map((d) => (
        // 임시보관함에서 여는 것은 새 작성이라 작성 방식 기본값대로 연다(WP-1744).
        <DraftRow key={d.id} d={d} onOpen={() => void openDraft(d.id, { placement: 'default' })} onDelete={() => del.mutate(d)} />
      ))}
    </div>
  )
}

/** 임시보관함의 오른쪽 칸(데스크톱) — 행을 누르면 작성창이 열리므로 상세 대신 안내만. */
export function MailDraftsDetailEmpty() {
  return (
    // WP-1947: 공용 EmptyState(짝인 MailScheduledDetailEmpty 와 같은 부품).
    <EmptyState
      testId="mail-drafts-detail-empty"
      className="h-full justify-center gap-3"
      icon={FilePen}
      grouped
      title="임시저장한 메일을 고르세요"
      description="누르면 작성창에서 이어 쓸 수 있어요"
    />
  )
}
