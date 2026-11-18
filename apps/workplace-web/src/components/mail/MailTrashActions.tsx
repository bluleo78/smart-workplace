// WP-1682 휴지통 메일 「완전히 삭제」·「휴지통 비우기」 화면 조각 — 목록 위 비우기 줄, 두 확인 창, 상세 단추(데스크톱)·⋯ 메뉴 항목(휴대폰).
// 메일함 화면(MailInboxPage)은 이 파일의 조각을 자리에 끼우고 상태만 넘긴다. 활성·이유·글자는 lib/mailTrashActions 의 순수 함수가 정한다.
import { Loader2, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip'
import { useStartTrashEmpty, useTrashEmptyStatus } from '@/hooks/queries/useMailTrash'
import { mailSubjectText } from '@/lib/mailSubject'
import {
  PERMANENT_DELETE_UNSUPPORTED_SHORT,
  permanentDeleteConfirmBody,
  TRASH_COPY_NOTE,
  type TrashButtonState,
  trashEmptyConfirmBody,
  trashEmptyRowText,
  trashEmptyState,
} from '@/lib/mailTrashActions'
import type { MailServerFolder } from '@/types/mailFolder'

/** 빨간 테두리 outline 단추 — 상세 「완전히 삭제」와 목록 위 「휴지통 비우기」가 같은 모양을 쓴다. */
const DESTRUCTIVE_OUTLINE = 'text-destructive border-destructive/40 hover:text-destructive'

/**
 * 목록 위 「휴지통 비우기」 줄 — 휴지통 보기에서만, 메일함 상태 줄(MailFolderStatusRow) 위에 둔다.
 * 왼쪽은 서버 휴지통 수·진행·미지원 글(좁으면 잘린다), 오른쪽은 줄지 않는 단추. 확인 창을 거쳐 비우기를 시작한다.
 * 비우기 진행 상태 query(끝날 때 토스트를 띄운다)는 이 줄 한 곳에서만 부른다 — 두 곳에서 부르면 토스트가 두 번 뜬다.
 */
export function MailTrashEmptyRow({
  accountId,
  folder,
  listEmpty,
}: {
  accountId: number
  /** 지금 보는 휴지통 행 — 메일함 목록을 아직 못 받았으면 undefined. */
  folder: MailServerFolder | undefined
  /** 화면 목록이 비었는지 — 서버 수(낡을 수 있음)와 함께 「빈 휴지통」을 판정한다. */
  listEmpty: boolean
}) {
  const status = useTrashEmptyStatus(accountId, true)
  const start = useStartTrashEmpty(accountId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 같은 틱의 연타 막기 — mutation 의 isPending 은 다시 그린 뒤에야 바뀌어 두 번째 클릭을 막지 못한다.
  const busy = useRef(false)
  const state = trashEmptyState(folder, status.data, listEmpty)
  const text = trashEmptyRowText(folder, status.data)
  const disabled = !state.enabled || start.isPending

  const confirm = () => {
    if (busy.current) return
    busy.current = true
    start.mutate(undefined, {
      // 시작 응답(또는 오류 토스트)까지 확인 창을 열어 두고 끝나면 닫는다 — 진행은 줄의 글이 이어 보인다.
      onSettled: () => {
        busy.current = false
        setConfirmOpen(false)
      },
    })
  }

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="mail-trash-empty"
      disabled={disabled}
      onClick={() => setConfirmOpen(true)}
      className={`h-7 shrink-0 max-lg:h-9 ${DESTRUCTIVE_OUTLINE}`}
    >
      {state.running || start.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}
      {state.label}
    </Button>
  )

  return (
    <div data-testid="mail-trash-empty-row" className="flex items-center gap-2 border-b py-1.5 pl-4 pr-3 text-xs text-muted-foreground">
      <span data-testid="mail-trash-empty-text" className="min-w-0 flex-1 truncate">
        {text}
      </span>
      {/* 꺼진 단추는 포인터·포커스를 받지 않아 이유 툴팁을 감싼 칸이 띄운다(진행 중은 이유 없이 라벨만 바뀐다). */}
      {!state.enabled && state.reason ? (
        <DisabledReasonTooltip reason={state.reason} aria-label={state.reason} data-testid="mail-trash-empty-reason" className="shrink-0">
          {button}
        </DisabledReasonTooltip>
      ) : (
        button
      )}
      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        entityName="메일"
        itemName="휴지통"
        title="휴지통을 비울까요?"
        description={trashEmptyConfirmBody(folder?.totalCount ?? null)}
        impact={TRASH_COPY_NOTE}
        actionLabel="비우기"
        pending={start.isPending}
        onConfirm={confirm}
        contentTestId="mail-trash-empty-confirm"
        confirmTestId="mail-trash-empty-confirm-ok"
      />
    </div>
  )
}

/**
 * 한 통 「완전히 삭제」 확인 창 — 데스크톱 상세 단추와 휴대폰 ⋯ 메뉴가 같은 창을 연다(controlled — 메뉴 밖에서 연다).
 * pending 동안은 열린 채 「삭제」가 꺼진다. 닫기는 호출부가 처리가 끝날 때 한다.
 */
export function MailPermanentDeleteDialog({
  open,
  onOpenChange,
  subject,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: string | null
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <DeleteConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      entityName="메일"
      itemName={mailSubjectText(subject)}
      title="메일을 완전히 삭제할까요?"
      description={permanentDeleteConfirmBody(subject)}
      impact={TRASH_COPY_NOTE}
      actionLabel="삭제"
      pending={pending}
      onConfirm={onConfirm}
      contentTestId="mail-permanent-delete-confirm"
      confirmTestId="mail-permanent-delete-confirm-ok"
    />
  )
}

/** 데스크톱 상세 작업 줄의 「완전히 삭제」 — 「되살리기」 바로 뒤. 처리 중엔 스피너·비활성, 미지원이면 비활성 + 이유 툴팁. */
export function MailPermanentDeleteButton({ state, pending, onClick }: { state: TrashButtonState; pending: boolean; onClick: () => void }) {
  const button = (
    <Button
      variant="outline"
      size="sm"
      data-testid="mail-permanent-delete"
      disabled={!state.enabled || pending}
      onClick={onClick}
      className={DESTRUCTIVE_OUTLINE}
    >
      {pending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Trash2 aria-hidden className="h-3.5 w-3.5" />} 완전히 삭제
    </Button>
  )
  return !state.enabled && state.reason ? (
    <DisabledReasonTooltip reason={state.reason} aria-label={state.reason} data-testid="mail-permanent-delete-reason">
      {button}
    </DisabledReasonTooltip>
  ) : (
    button
  )
}

/**
 * 휴대폰 상세 ⋯ 메뉴의 「완전히 삭제」 — 파괴적 항목이라 맨 아래(되살리기 다음), 빨간 글자.
 * 터치에는 툴팁이 없어 미지원이면 항목을 끄고 아래에 짧은 이유 글을 둔다 — 화면 낭독기도 꺼진 항목과 함께 읽게 aria-describedby 로 잇는다.
 */
export function MailPermanentDeleteMenuItem({ state, pending, onClick }: { state: TrashButtonState; pending: boolean; onClick: () => void }) {
  const reasonId = useId()
  return (
    <>
      <button
        type="button"
        data-testid="mail-permanent-delete"
        className="text-destructive disabled:opacity-50"
        disabled={!state.enabled || pending}
        aria-describedby={state.enabled ? undefined : reasonId}
        onClick={onClick}
      >
        {pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden className="h-4 w-4" />}
        완전히 삭제
      </button>
      {!state.enabled && (
        <p id={reasonId} data-testid="mail-permanent-delete-unsupported" className="px-3 pb-1.5 text-xs text-muted-foreground">
          {PERMANENT_DELETE_UNSUPPORTED_SHORT}
        </p>
      )}
    </>
  )
}
