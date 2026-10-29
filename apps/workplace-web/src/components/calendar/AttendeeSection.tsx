// 일정 참석자 섹션 — 사람·조직 고르기 창 + 칩 목록.
// - 생성 다이얼로그: 로컬 state 관리(onChange 콜백으로 부모에 전달).
// - 편집/상세: attendees prop 으로 현재 참석자 칩 표시(실시간 invite/remove 는 부모 처리).
// - 고르기 창(WP-1059): 노트 공유와 같은 사람·조직도 부서·내 그룹 창. 사람만 찾는다(AI 는 MCP 로만 참석자가 된다). 조직·내 그룹을 고르면
//   바로 넣지 않고 창 아래에 「개발팀 구성원 12명을 참석자로 추가합니다」를 보여 확인을 받은 뒤 그 시점의 활성 사람으로 풀어 넣는다
//   (참석 응답이 사람별이라 그룹 자체는 참석자로 두지 않는다 — 에픽 WP-1054). 큰 부서도 이 확인 한 번이다.
// 서버 참석자 중 AGENT 는 AgentBadge 표시, RSVP 상태는 아이콘으로 구분. (이슈 #489)
// 일정 폼의 참석자 아이콘 줄(배치 B) 안에 들어가 이름표 없이 칩과 「＋ 참석자」를 한 줄에 잇는다(넘치면 다음 줄).
// 조직으로 수백 명을 넣을 수 있어 칩은 앞의 ATTENDEE_CHIP_PREVIEW 개만 그리고 나머지는 「외 N명 더 보기」로 접는다(WP-1189,
// 상세 보기와 같은 문구) — 전원을 그리면 창이 수천 px 길어지고, 칩 뒤의 「＋ 참석자」에 붙은 고르기 창이 화면 밖으로 밀려났다.
import { useQueryClient } from '@tanstack/react-query'
import { Check, Clock, HelpCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { DashedAddChip } from '@/components/calendar/CalendarTagChip'
import { FORM_CHIP_LINE_CLASS } from '@/components/calendar/EventFormRow'
import type { GroupOption } from '@/components/members/groupOptions'
import { PeopleAndDepartmentPicker, type PickedPerson } from '@/components/members/PeopleAndDepartmentPicker'
import { type GroupExpansionPlan, planGroupExpansion } from '@/components/members/personalGroups'
import { Button } from '@/components/ui/button'
import { AgentBadge } from '@/components/users/AgentBadge'
import { groupAllMembersQuery } from '@/hooks/queries/useGroupMemberSearch'
import { useAuth } from '@/hooks/useAuth'
import { useShowMore } from '@/hooks/useShowMore'
import { attendeeDisplayName, attendeeKey, sortAttendeesForView } from '@/lib/calendarEventView'
import { HIT_AREA_CHIP_COARSE } from '@/lib/hitArea'
import { cn } from '@/lib/utils'
import type { Attendee, RsvpStatus } from '@/types/calendar'

import { ATTENDEE_LIMIT, groupInviteDetail, groupInviteTitle, isOverLimit } from './attendeeGroups'

/** 접힌 상태에서 그리는 참석자 칩 수 — 넘으면 「외 N명 더 보기」로 접는다(WP-1189). */
export const ATTENDEE_CHIP_PREVIEW = 10

/** 생성 모드에서 선택된 멤버의 표시 정보 — id 외에 이름을 저장해 칩 렌더에 활용(고르기 창이 사람만 찾아 종류는 두지 않는다, WP-1059) */
export interface SelectedMember {
  id: number
  name: string
}

// RSVP 상태 아이콘 — ACCEPTED=초록체크, DECLINED=회색X, TENTATIVE=물음표, NEEDS_ACTION=시계.
// 편집 칩과 상세 보기 참석자 목록(EventDetailView, WP-708)이 같은 아이콘을 쓴다. className 으로 크기만 바꾼다.
export function RsvpIcon({ status, className = 'h-3 w-3' }: { status: RsvpStatus; className?: string }) {
  switch (status) {
    case 'ACCEPTED':
      return <Check className={`${className} text-green-600`} aria-label="수락" />
    case 'DECLINED':
      return <X className={`${className} text-muted-foreground`} aria-label="거절" />
    case 'TENTATIVE':
      return <HelpCircle className={`${className} text-yellow-500`} aria-label="미정" />
    case 'NEEDS_ACTION':
    default:
      return <Clock className={`${className} text-muted-foreground`} aria-label="응답 대기" />
  }
}

interface AttendeeSectionProps {
  /** 생성 모드에서 선택된 멤버 목록 (id+이름) */
  selectedMembers: SelectedMember[]
  /** 선택 변경 콜백 — 생성 모드 전용 */
  onChange: (members: SelectedMember[]) => void
  /** 상세/편집 모드에서 서버에서 온 참석자 목록 */
  attendees?: Attendee[] | null
  /** 편집 모드에서 참석자 초대 콜백 — 있으면 선택 즉시 API 호출. 조직·내 그룹은 구성원을 한 요청으로 넘긴다(WP-1059) */
  onInvite?: (userIds: number[]) => void
  /** 편집 모드에서 참석자 제거 콜백 */
  onRemove?: (userId: number) => void
  /** true 면 "참석자 추가" 버튼을 숨긴다 — 편집 권한 없는 일정(주최자 아님·읽기전용)에서 눌러도 저장되지 않던 문제(WP-200) */
  hideAdd?: boolean
}

/** 고른 조직·내 그룹의 확인 상태 — 구성원을 받는 중·실패·받은 뒤 넣을 계획. */
type PendingGroup =
  | { group: GroupOption; status: 'loading' }
  | { group: GroupOption; status: 'error' }
  | { group: GroupOption; status: 'ready'; plan: GroupExpansionPlan }

/**
 * 참석자 섹션: 사람·조직 고르기 창 + 칩 목록.
 * - attendees 있으면 서버 데이터로 칩 렌더(주최자 먼저, AGENT 뱃지).
 * - attendees 없으면 selectedUserIds 기반 로컬 칩 렌더.
 */
export function AttendeeSection({
  selectedMembers,
  onChange,
  attendees,
  onInvite,
  onRemove,
  hideAdd = false,
}: AttendeeSectionProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<PendingGroup | null>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const meId = user?.id
  // 칩 접기 — 서버 참석자(편집) 또는 로컬 선택(만들기) 중 그리는 쪽의 수로 센다. 기본은 앞 ATTENDEE_CHIP_PREVIEW 개만.
  const moreChips = useShowMore(attendees?.length ?? selectedMembers.length, ATTENDEE_CHIP_PREVIEW)

  // 지금 참석자 id — 외부 참석자(userId=null)는 고르기 창에서 고를 수 없어 내부 userId 만 본다.
  const existingIds = attendees?.map((a) => a.userId).filter((id): id is number => id != null) ?? selectedMembers.map((m) => m.id)
  // 고르기 창이 「(이미 추가됨)」으로 보일 사람.
  const existingSet = new Set(existingIds)
  // 고르기 창 후보에서 뺄 사람 — 주최자인 나는 이미 참석자다.
  const excludeSet = new Set(meId != null ? [meId] : [])

  // 사람 넣기 — 편집 모드(onInvite 있음): 즉시 invite API 호출. 생성 모드: 로컬 state 업데이트(이름 포함). 중복은 넣지 않는다.
  // 넣으면 칩을 다시 접는다 — 펼친 채 늘면 칩 뒤 「＋ 참석자」와 거기 붙은 고르기 창이 다시 밀려난다(WP-1189).
  const addPeople = (people: SelectedMember[]) => {
    const fresh = people.filter((p) => !existingSet.has(p.id))
    if (fresh.length === 0) return
    moreChips.collapse()
    if (onInvite) onInvite(fresh.map((p) => p.id))
    else onChange([...selectedMembers, ...fresh])
  }

  // 만들기는 고른 사람 전체를 한 요청에 보내 한도(500명)를 넘으면 저장이 거절된다 — 다 찼으면 한 명씩도 더 넣지 않는다(WP-1112).
  // 편집은 고를 때마다 그 사람만 초대하므로 막지 않는다.
  const full = !onInvite && existingIds.length >= ATTENDEE_LIMIT

  // 사람 한 명을 고르면 바로 넣는다 — 조직 확인이 떠 있었으면 닫는다(다른 것을 고른 것이다).
  const handleSelectPerson = (userId: number, person: PickedPerson) => {
    setPending(null)
    if (full) return
    addPeople([{ id: userId, name: person.name }])
  }

  // 조직·내 그룹을 고르면 구성원(하위 포함, 활성 사람만)을 받아 넣을 계획을 보여 준다 — 넣기는 확인 단추로.
  // 부서·내 그룹 모두 사람으로 풀어 넣으므로 하위 포함 구성원 찾기 한 번으로 받는다(이름도 함께 와 만들기 칩을 바로 그린다).
  // 고르기 창의 부서 펼침과 같은 캐시라 펼쳐 본 부서는 다시 받지 않는다.
  const selectGroup = (group: GroupOption) => {
    setPending({ group, status: 'loading' })
    // 만들기는 고른 사람 전체를 한 요청에 보내므로 남은 자리만, 편집은 이번 초대만 보내므로 한도 그대로.
    const capacity = onInvite ? ATTENDEE_LIMIT : Math.max(0, ATTENDEE_LIMIT - existingIds.length)
    // 그 사이 다른 그룹을 골랐으면 늦게 온 결과로 덮지 않는다.
    const settle = (next: PendingGroup) => setPending((cur) => (cur?.group.id === group.id ? next : cur))
    queryClient.fetchQuery(groupAllMembersQuery(group.id)).then(
      (hits) => settle({ group, status: 'ready', plan: planGroupExpansion(hits, existingIds, meId, capacity) }),
      () => settle({ group, status: 'error' }),
    )
  }

  const confirmGroup = (plan: GroupExpansionPlan) => {
    addPeople(plan.toAdd)
    setPending(null)
  }

  // 닫으면 확인도 닫는다 — 다시 열 때 지난 그룹의 확인이 남지 않게.
  const handleOpenChange = (next: boolean) => {
    if (!next) setPending(null)
    setOpen(next)
  }

  // 주최자, 나, 나머지 순 — 접혀도 내 칩(응답 상태)은 앞에 보인다(상세 보기와 같은 순서).
  const sortedAttendees = attendees ? sortAttendeesForView(attendees, meId) : null


  // 조직·내 그룹 확인 줄 — 고르기 창 목록 아래. 넣을 사람이 없거나 한도를 넘으면 추가 단추를 막는다.
  // 알림 영역(role=status)은 글만 감싼다 — 단추까지 감싸면 바뀔 때마다 단추 이름까지 읽힌다.
  const plan = pending?.status === 'ready' ? pending.plan : null
  const detail = plan ? groupInviteDetail(plan) : ''
  // 넣을 수 없는 확인(넣을 사람 없음·한도 넘음)이면 「취소」가 포커스를 받는다 — 추가 단추가 없거나 막혀 포커스가 검색창에 남으면
  // Enter 가 같은 그룹을 다시 골라 확인 줄이 깜빡이기만 하고 키보드로는 빠져나갈 수 없었다(WP-1112).
  const cancelRef = useRef<HTMLButtonElement>(null)
  const blocked = plan != null && (plan.toAdd.length === 0 || isOverLimit(plan))
  useEffect(() => {
    if (blocked) cancelRef.current?.focus()
  }, [blocked, plan])
  // 취소하면 확인 줄이 사라지며 포커스가 문서 밖(body)으로 떨어지지 않게 고르기 창 검색칸으로 돌려준다.
  const cancelGroup = () => {
    const search = cancelRef.current?.closest('[role="dialog"]')?.querySelector<HTMLInputElement>('input')
    setPending(null)
    search?.focus()
  }
  const footer = pending ? (
    <div className="space-y-1 border-t bg-muted/40 px-3 py-2.5 text-sm" data-testid="attendee-group-confirm">
      <div role="status" className="space-y-1">
        {pending.status === 'loading' && <p className="text-muted-foreground">{pending.group.name} 구성원을 불러오는 중…</p>}
        {pending.status === 'error' && <p className="text-destructive">{pending.group.name} 구성원을 불러오지 못했습니다</p>}
        {plan && (
          <>
            <p className="font-medium" data-testid="attendee-group-confirm-title">
              {groupInviteTitle(pending.group.name, plan)}
            </p>
            {detail && (
              <p
                className={isOverLimit(plan) ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                data-testid="attendee-group-confirm-detail"
              >
                {detail}
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={cancelGroup}
          data-testid="attendee-group-cancel"
        >
          취소
        </Button>
        {plan && plan.toAdd.length > 0 && (
          // 나타나면 포커스를 받는다 — 검색창에 남으면 Enter 가 같은 그룹을 다시 골라 키보드로는 확인할 수 없다.
          <Button
            type="button"
            size="sm"
            autoFocus
            disabled={isOverLimit(plan)}
            onClick={() => confirmGroup(plan)}
            data-testid="attendee-group-add"
          >
            {plan.toAdd.length}명 추가
          </Button>
        )}
      </div>
    </div>
  ) : full ? (
    // 다 찬 만들기 — 사람을 골라도 넣지 않는 까닭을 고르기 창 아래에 알린다.
    <p role="status" className="border-t bg-muted/40 px-3 py-2.5 text-sm text-destructive" data-testid="attendee-limit-full">
      참석자는 {ATTENDEE_LIMIT}명까지라 더 넣을 수 없습니다
    </p>
  ) : null

  return (
    // 이름표 대신 그룹 이름 — 아이콘 줄이라 「참석자」가 화면에 쓰여 있지 않다
    <div className={FORM_CHIP_LINE_CLASS} role="group" aria-label="참석자" data-testid="attendee-section">
      {/* 참석자 칩 목록 */}
      {sortedAttendees && sortedAttendees.length > 0 && (
        // contents — 칩이 「＋ 참석자」와 같은 줄에 이어지도록 감싸는 상자를 레이아웃에서 뺀다(testid 는 유지)
        <div className="contents" data-testid="attendee-chips">
          {sortedAttendees.slice(0, moreChips.limit).map((a, i) => {
              const chipKey = attendeeKey(a, i)
              const removeId = a.userId // 외부 참석자는 제거 대상 아님(null)
              return (
                <span
                  key={chipKey}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                  data-testid={`attendee-chip-${chipKey}`}
                >
                  <span>{attendeeDisplayName(a)}</span>
                  {/* AI 참석자는 MCP(create_event·update_event)로만 들어온다 — 서버 참석자에만 배지가 있다 */}
                  {a.kind === 'AGENT' && <AgentBadge size="xs" />}
                  <RsvpIcon status={a.rsvpStatus} />
                  {/* 주최자·외부 참석자가 아닌 경우에만 제거 버튼 표시 */}
                  {a.role !== 'ORGANIZER' && a.kind !== 'EXTERNAL' && onRemove && removeId != null && (
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:text-destructive"
                      onClick={() => onRemove(removeId)}
                      aria-label={`${a.name} 제거`}
                      data-testid={`attendee-remove-${removeId}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              )
            })}
        </div>
      )}

      {/* 생성 모드에서 로컬 선택 칩(서버 데이터 없을 때) — 고르기 창이 사람만 찾으므로 AI 배지는 없다(WP-1059) */}
      {!sortedAttendees && selectedMembers.length > 0 && (
        <div className="contents" data-testid="attendee-selected-chips">
          {selectedMembers.slice(0, moreChips.limit).map((member) => (
            <span
              key={member.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              data-testid={`attendee-selected-${member.id}`}
            >
              <span>{member.name}</span>
              <button
                type="button"
                className="ml-0.5 rounded-full hover:text-destructive"
                onClick={() => onChange(selectedMembers.filter((m) => m.id !== member.id))}
                aria-label={`${member.name} 선택 취소`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 접힌 칩 펼치기·접기 — 칩 줄 안의 글자 단추 */}
      {moreChips.overflow > 0 && (
        // 칩 줄의 「＋」 칩처럼 터치에서 위아래로 넓혀 44px 넘게 눌린다
        <button
          type="button"
          className={cn('rounded-full px-1.5 py-0.5 text-xs text-primary hover:underline', HIT_AREA_CHIP_COARSE)}
          onClick={moreChips.toggle}
          aria-expanded={moreChips.expanded}
          data-testid="attendee-chips-toggle"
        >
          {moreChips.label}
        </button>
      )}

      {/* 참석자 추가 — 사람·조직도 부서·내 그룹 고르기 창 */}
      {!hideAdd && (
        <PeopleAndDepartmentPicker
          open={open}
          onOpenChange={handleOpenChange}
          existingUserIds={existingSet}
          excludeUserIds={excludeSet}
          onSelectPerson={handleSelectPerson}
          onSelectDepartment={selectGroup}
          onSelectPersonalGroup={selectGroup}
          testIdPrefix="attendee-picker"
          placeholder="이름·부서·그룹으로 검색"
          footer={footer}
          trigger={
            <DashedAddChip aria-label="참석자 추가" data-testid="attendee-add-btn">
              참석자
            </DashedAddChip>
          }
        />
      )}
    </div>
  )
}
