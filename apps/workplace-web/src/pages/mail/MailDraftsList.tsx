// 임시보관함 목록(WP-577) — 받은편지함 목록 열 자리에 그린다. 행을 누르면 상세 패널이 아니라 작성창이 그 내용으로 열린다.
// 삭제는 행 hover·모바일 스와이프 대신 ⋯ 메뉴에 둔다(데스크톱·터치 같은 방법). 지운 뒤 토스트 「되돌리기」로 다시 만든다.
import { FilePen, MoreHorizontal, Paperclip, PenLine, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { draftRecipientsLabel } from '@/lib/mailDraftCompose'
import { formatReceivedAt } from '@/lib/mailListTime'
import { cn } from '@/lib/utils'

import { useDeleteMailDraft, useMailDrafts, useOpenMailDraft } from '../../hooks/queries/useMailDrafts'
import type { MailDraftSummary } from '../../types/mailDraft'

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
    // 받은편지함 행과 같은 카드형 클릭 영역(div role=button) — 안에 ⋯ 메뉴 버튼이 있어 바깥을 <button> 으로 감싸지 않는다.
    <div
      role="button"
      tabIndex={0}
      data-testid={`mail-draft-row-${d.id}`}
      aria-label={`임시저장 ${recipients || '받는사람 없음'} ${d.subject || '(제목 없음)'}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      // 키보드 초점은 받은편지함 행과 같이 기본 초점 테두리(전역 outline-ring)로 보인다 — 배경만 바꾸면 hover 와 구분되지 않았다.
      className="flex w-full cursor-pointer flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50"
    >
      <span className="flex items-center gap-2">
        {/* 임시저장 표식 — 보낸 메일·받은 메일과 한눈에 구분되게 빨간 글자(Gmail 의 Draft 표식과 같은 역할). */}
        <span className="shrink-0 text-xs font-semibold text-destructive-text">임시저장</span>
        <span className={cn('min-w-0 flex-1 truncate text-sm', !recipients && 'text-muted-foreground')}>
          {recipients || '받는사람 없음'}
        </span>
        {d.attachmentCount > 0 && (
          <Paperclip
            data-testid={`mail-draft-attachment-${d.id}`}
            aria-label={`첨부 ${d.attachmentCount}개`}
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{formatReceivedAt(d.updatedAt)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid={`mail-draft-menu-${d.id}`}
            aria-label="임시저장 메뉴"
            // 행 열기와 분리 — 메뉴 버튼을 눌러도 작성창이 열리지 않게.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            // 데스크톱은 작은 아이콘 버튼, 터치는 위아래로 넓혀 44px(행 높이는 그대로).
            className="-my-1 -mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:-my-2.5 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:-mr-3"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem data-testid={`mail-draft-open-${d.id}`} onSelect={onOpen}>
              <PenLine /> 이어 쓰기
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" data-testid={`mail-draft-delete-${d.id}`} onSelect={onDelete}>
              <Trash2 /> 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <span className={cn('truncate text-sm', !d.subject && 'text-muted-foreground')}>{d.subject || '(제목 없음)'}</span>
      {d.preview && (
        <span aria-hidden="true" className="truncate text-xs text-muted-foreground">
          {d.preview}
        </span>
      )}
    </div>
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
      <div data-testid="mail-drafts-empty" className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <FilePen className="h-8 w-8" />
        <p className="text-sm font-medium">임시저장한 메일이 없어요</p>
        <p className="text-xs">쓰다가 닫은 메일은 여기에 저장돼요.</p>
      </div>
    )
  }
  return (
    <div data-testid="mail-drafts-list" className="flex-1 overflow-y-auto">
      {data.map((d) => (
        <DraftRow key={d.id} d={d} onOpen={() => void openDraft(d.id)} onDelete={() => del.mutate(d)} />
      ))}
    </div>
  )
}

/** 임시보관함의 오른쪽 칸(데스크톱) — 행을 누르면 작성창이 열리므로 상세 대신 안내만. */
export function MailDraftsDetailEmpty() {
  return (
    <div data-testid="mail-drafts-detail-empty" className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <FilePen className="h-10 w-10 text-muted-foreground/50" />
      <div>
        <p className="text-sm font-medium">임시저장한 메일을 고르세요</p>
        <p className="mt-1 text-xs text-muted-foreground">누르면 작성창에서 이어 쓸 수 있어요</p>
      </div>
    </div>
  )
}
