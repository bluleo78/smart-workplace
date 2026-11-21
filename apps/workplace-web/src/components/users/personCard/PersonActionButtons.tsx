// 사람 카드 단추 줄(WP-1769) — 메시지 · 메일 쓰기(또는 일 맡기기) · 일정 잡기 / 나 → 내 프로필 / 비활성 → 안내 문구.
// 사람 카드(팝오버·시트)와 연락처 상세 패널이 같은 단추·같은 막힘 규칙을 쓰도록 카드 본문에서 떼어 낸 공용 컴포넌트.
// 팝오버 밖에서도 동작한다 — onDone 이 없으면 단추를 눌러도 닫을 것이 없고, PersonCardAssignContext 가 없으면 AI 의 「일 맡기기」만 빠진다.
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useMailCompose } from '@/components/mail/MailComposeContext'
import { Button } from '@/components/ui/button'
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip'
import { useCreateDm } from '@/hooks/queries/useCreateDm'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

import { composeDraftTo, dmPath, newEventPath, PROFILE_PATH } from './personCardActions'
import { usePersonCardAssign } from './PersonCardAssignContext'
import { usePersonMailAccounts } from './usePersonMailAccounts'

// 단추 셋은 가로 3등분 한 줄 — 좁은 시트(390px)에서도 줄바꿈·넘침 없이 글자가 줄임표로 잘린다.
// 메일 단추는 래퍼(span) 안에서 w-full 로 채운다(flex-1 대신).
const ACTION_CLASS = 'min-w-0 flex-1 truncate px-2'

export function PersonActionButtons({
  personId,
  kind,
  username,
  email,
  active,
  emailLoading = false,
  onDone,
  className,
}: {
  personId: number
  /** 모르면(undefined) 비활성·나 분기만 그리고, 그 밖에는 단추를 단정하지 않아 아무것도 그리지 않는다. */
  kind?: 'HUMAN' | 'AGENT'
  username?: string
  email: string | null
  active: boolean
  /** 이메일을 아직 모르는 동안 true — 메일 막힘 이유를 단정하지 않는다(카드: profileLoading). 기본 false */
  emailLoading?: boolean
  /** 단추·링크를 누른 뒤 부른다(카드는 닫기). 없으면 아무것도 안 함 */
  onDone?: () => void
  className?: string
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const createDm = useCreateDm()
  const { openCompose } = useMailCompose()
  // 화면(이슈 상세 등)이 깐 「일 맡기기」 처리기 — 없으면 AI 에 그 단추가 없다.
  const onAssignWork = usePersonCardAssign()

  const isAgent = kind === 'AGENT'
  const isHuman = kind === 'HUMAN'
  const isMe = user?.id === personId
  const { data: accounts, isLoading: accountsLoading } = usePersonMailAccounts(kind, personId)
  const account = accounts?.[0]

  function openDm() {
    createDm.mutate([personId], {
      onSuccess: (dm) => {
        onDone?.()
        navigate(dmPath(dm.id))
      },
      // useCreateDm 의 onError 가 토스트를 띄운다 — 카드는 열어 두어 다시 누를 수 있게 한다.
    })
  }

  function compose() {
    if (!account || !email) return
    onDone?.()
    openCompose(composeDraftTo(account.id, email))
  }

  function goCalendar() {
    if (!username) {
      toast.error('일정을 잡을 수 없습니다')
      return
    }
    onDone?.()
    navigate(newEventPath(username))
  }

  // 비활성이 나(self)보다 앞선다 — 정지된 계정에는 어떤 단추도 주지 않는다. kind 와 무관하므로 kind 분기보다 먼저 본다.
  if (!active) {
    return <p className={cn('text-center text-xs text-muted-foreground', className)}>비활성 멤버</p>
  }
  if (isMe) {
    return (
      <Button asChild variant="outline" size="sm" className={cn('w-full', className)}>
        <Link to={PROFILE_PATH} onClick={onDone}>
          내 프로필
        </Link>
      </Button>
    )
  }
  // kind 를 끝내 모르면 단추를 단정할 수 없어 두지 않는다.
  if (!isAgent && !isHuman) return null

  // 막힌 메일 단추 — 이유를 툴팁으로(없는 이메일 · 연결 안 된 계정). 눌러도 아무 일 없다(aria-disabled).
  // 불러오는 중에는 이유를 단정하지 않는다 — 흐리게만 두고 툴팁 없이(「이메일 없음」이 번쩍이지 않게). 요청이 실패하면 아래 이유로 떨어진다.
  const mailLoading = emailLoading || accountsLoading
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

  return (
    <div className={cn('flex gap-2', className)}>
      <Button type="button" variant="outline" size="sm" className={ACTION_CLASS} onClick={openDm} disabled={createDm.isPending}>
        메시지
      </Button>
      {isAgent ? (
        onAssignWork && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={ACTION_CLASS}
            onClick={() => {
              onDone?.()
              onAssignWork(personId)
            }}
          >
            일 맡기기
          </Button>
        )
      ) : (
        // 늘 같은 감싸개로 감싼다(WP-1856) — 이유가 생기고 사라져도 단추가 다시 만들어지지 않아 키보드 초점을 잃지 않는다.
        // 이름은 이유가 있을 때만 `메일 쓰기 — <이유>`.
        <DisabledReasonTooltip
          reason={shownReason}
          label="메일 쓰기"
          className="min-w-0 flex-1"
        >
          {mailButton}
        </DisabledReasonTooltip>
      )}
      <Button type="button" variant="outline" size="sm" className={ACTION_CLASS} onClick={goCalendar}>
        일정 잡기
      </Button>
    </div>
  )
}
