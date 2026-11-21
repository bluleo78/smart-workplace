// 예약됨 목록(WP-1787) — 보낼 시각을 정해 둔 메일. 행 모양은 임시보관함(MailDraftsList)과 같은 3줄이되 첫 줄 앞이 「임시저장」 표식 대신
// 보낼 시각(주색)이다. 행을 누르면 예약을 풀고(cancel-send → 임시보관함으로 돌아옴) 그 임시저장을 쓰기 창으로 연다.
// ⋯ 메뉴: 「바로 보내기」(지금 나간다)·「예약 취소」(예약만 풀어 임시보관함으로 옮긴다). 늦었으면(409·404) 훅이 「이미 보냄」으로 알린다.
import { Clock, Send, Undo2 } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'

import { emptyStateDescriptionClass, emptyStateIconClass, emptyStateTitleClass } from '@/components/layout/empty-state'
import { DropdownMenuItem } from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { parseAddressList, recipientShortName } from '@/lib/mailRecipients'
import { formatScheduleLabel } from '@/lib/mailSchedule'
import { mailSubjectText } from '@/lib/mailSubject'
import { cn } from '@/lib/utils'

import {
  useCancelScheduledMail,
  useOpenMailDraft,
  useScheduledMailDrafts,
  useSendScheduledNow,
} from '../../hooks/queries/useMailDrafts'
import type { MailScheduledSummary } from '../../types/mailDraft'
import { MailListRowShell } from './MailListRowShell'

/** 받는 사람 라벨 — 1명은 이름, 2명 이상은 「김지은 외 2명」(첫 사람 + 나머지 수). 없으면 빈 문자열. */
function scheduledRecipientsLabel(to: string[]): string {
  const names = to.flatMap((raw) => parseAddressList(raw)).map(recipientShortName)
  if (names.length <= 1) return names[0] ?? ''
  return `${names[0]} 외 ${names.length - 1}명`
}

/** 예약 한 행 — 시각 · 받는 사람 · 첨부 · ⋯ / 제목 / 미리보기. 행은 버튼이 아니다(⋯ 버튼 중첩 금지 — 임시보관함 행과 같은 방식). */
function ScheduledRow({
  d,
  now,
  onOpen,
  onSendNow,
  onCancel,
}: {
  d: MailScheduledSummary
  now: Date
  onOpen: () => void
  onSendNow: () => void
  onCancel: () => void
}) {
  const recipients = scheduledRecipientsLabel(d.to)
  const at = formatScheduleLabel(new Date(d.sendAt), now)
  return (
    <MailListRowShell
      testId="mail-scheduled-row"
      rowAttrs={{ 'data-draft-id': d.id }}
      onOpen={onOpen}
      openLabel={`예약 ${at} ${recipients || '받는사람 없음'} ${mailSubjectText(d.subject)}`}
      lead={
        <>
          <span data-testid="mail-scheduled-at" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {at}
          </span>
          <span className={cn('min-w-0 flex-1 truncate text-sm', !recipients && 'text-muted-foreground')}>
            {recipients || '받는사람 없음'}
          </span>
        </>
      }
      attachmentCount={d.attachmentCount}
      menuTestId="mail-scheduled-more"
      menuLabel="예약 메뉴"
      menuItems={
        <>
          <DropdownMenuItem data-testid="mail-scheduled-send-now" onSelect={onSendNow}>
            <Send /> 바로 보내기
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="mail-scheduled-cancel" onSelect={onCancel}>
            <Undo2 /> 예약 취소
          </DropdownMenuItem>
        </>
      }
      subject={d.subject}
      preview={d.preview}
    />
  )
}

/** 예약됨 목록 열 — 로딩·오류·빈 상태·행 목록(보낼 시각 오름차순은 서버 순서 그대로). */
export function MailScheduledList({ accountId }: { accountId: number }) {
  const { data, isLoading, isError, refetch } = useScheduledMailDrafts(accountId)
  const openDraft = useOpenMailDraft()
  const sendNow = useSendScheduledNow(accountId)
  const cancel = useCancelScheduledMail(accountId)
  // 라벨 기준 시각 — 렌더마다 새로 잡는다(30초 재조회·변경으로 다시 그려질 때 「오늘」·「내일」이 갱신된다).
  const now = new Date()
  /**
   * 행 하나에 대한 변경이 진행 중인 id — 같은 행을 연달아 누르면(더블클릭·⋯ 뒤 행) 두 번째 요청이 이미 풀린 예약에 가 409/404 로
   * 「이미 보냄」을 잘못 알리고 첫 요청의 열기가 사라지므로, 진행 중인 행은 무시한다.
   */
  const busy = useRef(new Set<number>())

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="mb-2 text-sm text-destructive">예약한 메일을 불러오지 못했습니다</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          다시 시도
        </Button>
      </div>
    )
  }
  if (!data || data.length === 0) {
    return (
      <div data-testid="mail-scheduled-empty" className="flex flex-col items-center gap-2 py-16 text-center">
        <Clock className={emptyStateIconClass} aria-hidden="true" />
        <p className={emptyStateTitleClass}>예약한 메일 없음</p>
        <p className={emptyStateDescriptionClass}>쓰기 창의 보내기 옆 ▾ 에서 보낼 시각을 정할 수 있어요.</p>
      </div>
    )
  }

  /** busy 로 감싸 한 행에 한 번에 하나만 돌린다. 실패는 훅이 토스트로 알리므로 여기서는 삼킨다. */
  const guarded = (id: number, run: () => Promise<void>) => {
    if (busy.current.has(id)) return
    busy.current.add(id)
    void run().catch(() => {}).finally(() => busy.current.delete(id))
  }
  // 호출마다 mutateAsync 의 결과로 이어 간다 — mutate 의 호출별 onSuccess 는 뒤 호출이 시작되면 버려진다(여러 행을 빠르게 누를 때).
  /** 행 열기 — 예약을 먼저 풀고(임시보관함으로 돌아온다) 받은 상세로 쓰기 창을 연다. 풀지 못하면(이미 보냄) 훅이 알리고 열지 않는다. */
  const open = (id: number) =>
    guarded(id, async () => {
      const detail = await cancel.mutateAsync(id)
      await openDraft(id, { detail })
    })
  const sendNowRow = (id: number) =>
    guarded(id, async () => {
      await sendNow.mutateAsync(id)
      toast('곧 보냅니다')
    })
  const cancelRow = (id: number) =>
    guarded(id, async () => {
      await cancel.mutateAsync(id)
      toast('임시보관함으로 옮겼습니다')
    })

  return (
    <div data-testid="mail-scheduled-list" className="flex-1 overflow-y-auto">
      {data.map((d) => (
        <ScheduledRow
          key={d.id}
          d={d}
          now={now}
          onOpen={() => open(d.id)}
          onSendNow={() => sendNowRow(d.id)}
          onCancel={() => cancelRow(d.id)}
        />
      ))}
    </div>
  )
}

/** 예약됨의 오른쪽 칸(데스크톱) — 행을 누르면 쓰기 창이 열리므로 상세 대신 안내만. */
export function MailScheduledDetailEmpty() {
  return (
    <div data-testid="mail-scheduled-detail-empty" className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Clock className={emptyStateIconClass} aria-hidden="true" />
      <p className={emptyStateTitleClass}>예약한 메일 선택</p>
    </div>
  )
}
