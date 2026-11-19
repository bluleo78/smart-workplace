// 사람 카드 내용(WP-1767) — 머리(아바타·이름·직책·아이디) · 정보 줄 · 단추 한 줄 · 연락처 링크.
// 팝오버(데스크톱)와 아래 시트(모바일)가 같은 내용을 쓴다. 프로필 요청이 실패해도 PersonRef 만으로 이름과 kind 별 단추를 그린다.
import { Bot } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useMailCompose } from '@/components/mail/MailComposeContext'
import { Button } from '@/components/ui/button'
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip'
import { UserAvatar } from '@/components/users/UserAvatar'
import { useCreateDm } from '@/hooks/queries/useCreateDm'
import { useMailAccounts } from '@/hooks/queries/useMailAccounts'
import { useAuth } from '@/hooks/useAuth'

import { composeDraftTo, contactPath, dmPath, newEventPath, PROFILE_PATH } from './personCardActions'
import { usePersonCardAssign } from './PersonCardAssignContext'
import { type PersonRef, usePersonCard } from './usePersonCard'

// 단추 셋은 가로 3등분 한 줄 — 좁은 시트(390px)에서도 줄바꿈·넘침 없이 글자가 줄임표로 잘린다.
const ACTION_CLASS = 'min-w-0 flex-1 truncate px-2'

export function PersonCardBody({
  person,
  onClose,
}: {
  person: PersonRef
  /** 단추·링크를 누르면 카드를 닫는다. */
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile, groups, slotsUsed, profileLoading } = usePersonCard(person)
  const createDm = useCreateDm()
  const { openCompose } = useMailCompose()
  // 화면(이슈 상세 등)이 깐 「일 맡기기」 처리기 — 없으면 AI 카드에 그 단추가 없다.
  const onAssignWork = usePersonCardAssign()

  const isAgent = person.kind === 'AGENT'
  const isMe = user?.id === person.id
  // 메일 단추는 다른 사람(HUMAN) 카드에만 있다 — AI·나 카드에서는 계정 목록을 받지 않는다.
  const { data: accounts, isLoading: accountsLoading } = useMailAccounts({ enabled: !isAgent && !isMe })
  // 비활성이 나(self)보다 앞선다 — 정지된 계정에는 어떤 단추도 주지 않는다.
  const inactive = profile?.active === false || person.active === false
  const username = person.username ?? profile?.username
  const email = profile?.email ?? null
  const subtitle = [profile?.title, profile?.department].filter(Boolean).join(' · ')
  const account = accounts?.[0]

  function openDm() {
    createDm.mutate([person.id], {
      onSuccess: (dm) => {
        onClose()
        navigate(dmPath(dm.id))
      },
      // useCreateDm 의 onError 가 토스트를 띄운다 — 카드는 열어 두어 다시 누를 수 있게 한다.
    })
  }

  function compose() {
    if (!account || !email) return
    onClose()
    openCompose(composeDraftTo(account.id, email))
  }

  function goCalendar() {
    if (!username) {
      toast.error('일정을 잡을 수 없습니다')
      return
    }
    onClose()
    navigate(newEventPath(username))
  }

  const messageButton = (
    <Button type="button" variant="outline" size="sm" className={ACTION_CLASS} onClick={openDm} disabled={createDm.isPending}>
      메시지
    </Button>
  )
  const calendarButton = (
    <Button type="button" variant="outline" size="sm" className={ACTION_CLASS} onClick={goCalendar}>
      일정 잡기
    </Button>
  )
  // 막힌 메일 단추 — 이유를 툴팁으로(없는 이메일 · 연결 안 된 계정). 눌러도 아무 일 없다(aria-disabled).
  // 불러오는 중에는 이유를 단정하지 않는다 — 흐리게만 두고 툴팁 없이(「이메일 없음」이 번쩍이지 않게). 요청이 실패하면 아래 이유로 떨어진다.
  const mailLoading = profileLoading || accountsLoading
  const mailReason = !email ? '이메일 없음' : !account ? '메일 계정 연결 필요' : null
  const mailBlocked = mailLoading || mailReason !== null
  // 툴팁으로 보일 이유 — 불러오는 중에는 단정하지 않는다.
  const shownReason = mailLoading ? null : mailReason
  const mailButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full min-w-0 truncate px-2"
      aria-disabled={mailBlocked ? true : undefined}
      // 툴팁 래퍼(span)가 탭 정지점을 맡는다 — 안쪽 단추는 빼서 Tab 한 번에 하나만 잡힌다.
      tabIndex={shownReason ? -1 : undefined}
      onClick={mailBlocked ? undefined : compose}
    >
      메일 쓰기
    </Button>
  )

  // 비활성 여부를 모르는 동안(호출부가 active 를 안 줬고 프로필 응답 전)은 단추를 미룬다 — 단추가 떴다 사라지지 않게. 실패하면 단추로 떨어진다.
  const actionsPending = person.active === undefined && profileLoading
  // 단추를 미룬 동안 열림 포커스는 카드 틀에 머문다 — 단추가 나타나면 포커스가 카드 밖(틀)에 있을 때만 첫 단추로 옮긴다(사용자가 이미 카드 안으로 옮겼으면 건드리지 않는다).
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (actionsPending) return
    const el = cardRef.current
    if (!el || el.contains(document.activeElement)) return
    el.querySelector<HTMLElement>('button, a[href]')?.focus()
  }, [actionsPending])

  let actions: ReactNode = null
  if (actionsPending) {
    actions = <div data-testid="person-card-actions-pending" className="h-8 animate-pulse rounded-md bg-muted/40" aria-hidden />
  } else if (inactive) {
    actions = <p className="text-center text-xs text-muted-foreground">비활성 멤버</p>
  } else if (isMe) {
    actions = (
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to={PROFILE_PATH} onClick={onClose}>
          내 프로필
        </Link>
      </Button>
    )
  } else {
    actions = (
      <div className="flex gap-2">
        {messageButton}
        {isAgent ? (
          onAssignWork && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={ACTION_CLASS}
              onClick={() => {
                onClose()
                onAssignWork(person.id)
              }}
            >
              일 맡기기
            </Button>
          )
        ) : shownReason ? (
          <DisabledReasonTooltip reason={shownReason} className="min-w-0 flex-1">
            {mailButton}
          </DisabledReasonTooltip>
        ) : (
          <span className="flex min-w-0 flex-1">{mailButton}</span>
        )}
        {calendarButton}
      </div>
    )
  }

  return (
    // 카드 안 클릭은 위로 올리지 않는다 — 포털 안 클릭도 React 조상(코멘트 행·고르기 버튼)으로 올라간다.
    // 키 입력은 여기서 막지 않는다 — 막으면 바깥 PopoverContent/SheetContent 의 FocusScope(Tab 순환)가 키를 못 받는다. 키 전파는 그 틀이 막는다.
    <div ref={cardRef} data-testid="person-card" className="flex flex-col gap-3 p-4" onClick={(e: MouseEvent) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        <UserAvatar user={{ id: person.id, username: username ?? '', name: person.name }} size="lg" agent={isAgent} inactive={inactive} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{person.name}</span>
            {isAgent && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-ai-accent-subtle px-1 text-xs text-ai-accent">
                <Bot className="h-3 w-3" aria-hidden />
                AI
              </span>
            )}
          </div>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          {username && <p className="truncate text-xs text-muted-foreground">{username}</p>}
        </div>
      </div>

      {isAgent && profile?.description && <p className="text-xs break-words text-muted-foreground">{profile.description}</p>}
      {isAgent && slotsUsed !== undefined && <p className="text-xs text-muted-foreground">지금 작업 {slotsUsed}개</p>}
      {!isAgent && groups && groups.length > 0 && <p className="text-xs break-words text-muted-foreground">{groups.join(', ')}</p>}

      {actions}

      {!isAgent && (
        <Link
          to={contactPath(person.id)}
          onClick={onClose}
          className="text-xs text-primary underline underline-offset-2"
        >
          연락처에서 보기
        </Link>
      )}
    </div>
  )
}
