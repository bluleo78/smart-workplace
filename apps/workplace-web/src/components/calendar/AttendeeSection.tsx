// 일정 참석자 섹션 — 멤버 검색 피커 + 칩 목록.
// - 생성 다이얼로그: 로컬 state 관리(onChange 콜백으로 부모에 전달).
// - 편집/상세: attendees prop 으로 현재 참석자 칩 표시(실시간 invite/remove 는 부모 처리).
// AGENT 참석자는 AgentBadge 표시, RSVP 상태는 아이콘으로 구분. (이슈 #489)
import { Check, Clock, HelpCircle, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AgentBadge } from '@/components/users/AgentBadge'
import type { UserResponse } from '@/types/auth'
import type { Attendee, RsvpStatus } from '@/types/calendar'
import type { UserKind } from '@/types/user'

/** 생성 모드에서 선택된 멤버의 표시 정보 — id 외에 이름/종류를 저장해 칩 렌더에 활용 */
export interface SelectedMember {
  id: number
  name: string
  kind: UserKind
}

import { MemberSearchPopover } from '../../pages/projects/components/MemberSearchPopover'

// RSVP 상태 아이콘 — ACCEPTED=초록체크, DECLINED=회색X, TENTATIVE=물음표, NEEDS_ACTION=시계
function RsvpIcon({ status }: { status: RsvpStatus }) {
  switch (status) {
    case 'ACCEPTED':
      return <Check className="h-3 w-3 text-green-600" aria-label="수락" />
    case 'DECLINED':
      return <X className="h-3 w-3 text-muted-foreground" aria-label="거절" />
    case 'TENTATIVE':
      return <HelpCircle className="h-3 w-3 text-yellow-500" aria-label="미정" />
    case 'NEEDS_ACTION':
    default:
      return <Clock className="h-3 w-3 text-muted-foreground" aria-label="응답 대기" />
  }
}

interface AttendeeSectionProps {
  /** 생성 모드에서 선택된 멤버 목록 (id+이름+종류 포함) */
  selectedMembers: SelectedMember[]
  /** 선택 변경 콜백 — 생성 모드 전용 */
  onChange: (members: SelectedMember[]) => void
  /** 상세/편집 모드에서 서버에서 온 참석자 목록 */
  attendees?: Attendee[] | null
  /** 편집 모드에서 참석자 초대 콜백 — 있으면 선택 즉시 API 호출 */
  onInvite?: (userId: number) => void
  /** 편집 모드에서 참석자 제거 콜백 */
  onRemove?: (userId: number) => void
}

/**
 * 참석자 섹션: 멤버 검색 팝오버 + 칩 목록.
 * - attendees 있으면 서버 데이터로 칩 렌더(주최자 먼저, AGENT 뱃지).
 * - attendees 없으면 selectedUserIds 기반 로컬 칩 렌더.
 */
export function AttendeeSection({
  selectedMembers,
  onChange,
  attendees,
  onInvite,
  onRemove,
}: AttendeeSectionProps) {
  const [open, setOpen] = useState(false)

  // 참석자 선택 핸들러 — 중복 방지.
  // 편집 모드(onInvite 있음): 즉시 invite API 호출. 생성 모드: 로컬 state 업데이트(이름+종류 포함).
  const handleSelect = (user: UserResponse) => {
    const existingIds = attendees?.map((a) => a.userId) ?? selectedMembers.map((m) => m.id)
    if (existingIds.includes(user.id)) return
    if (onInvite) {
      onInvite(user.id)
    } else {
      onChange([...selectedMembers, { id: user.id, name: user.name, kind: user.kind }])
    }
  }

  // 기존 멤버 id Set — 팝오버가 "이미 선택됨" 표시를 위해 사용
  const existingSet = new Set(attendees?.map((a) => a.userId) ?? selectedMembers.map((m) => m.id))

  // 주최자를 먼저 정렬
  const sortedAttendees = attendees
    ? [...attendees].sort((a, b) => {
        if (a.role === 'ORGANIZER') return -1
        if (b.role === 'ORGANIZER') return 1
        return 0
      })
    : null

  return (
    <div className="space-y-2" data-testid="attendee-section">
      <Label>참석자</Label>

      {/* 참석자 칩 목록 */}
      {sortedAttendees && sortedAttendees.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="attendee-chips">
          {sortedAttendees.map((a) => (
            <span
              key={a.userId}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              data-testid={`attendee-chip-${a.userId}`}
            >
              <span>{a.name}</span>
              {a.kind === 'AGENT' && <AgentBadge size="xs" />}
              <RsvpIcon status={a.rsvpStatus} />
              {/* 주최자가 아닌 참석자는 제거 가능 */}
              {a.role !== 'ORGANIZER' && onRemove && (
                <button
                  type="button"
                  className="ml-0.5 rounded-full hover:text-destructive"
                  onClick={() => onRemove(a.userId)}
                  aria-label={`${a.name} 제거`}
                  data-testid={`attendee-remove-${a.userId}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* 생성 모드에서 로컬 선택 칩(서버 데이터 없을 때) — 이름과 AGENT 뱃지 표시 */}
      {!sortedAttendees && selectedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="attendee-selected-chips">
          {selectedMembers.map((member) => (
            <span
              key={member.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              data-testid={`attendee-selected-${member.id}`}
            >
              <span>{member.name}</span>
              {member.kind === 'AGENT' && <AgentBadge size="xs" />}
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

      {/* 참석자 추가 팝오버 */}
      <MemberSearchPopover
        open={open}
        onOpenChange={setOpen}
        existingMemberIds={existingSet}
        onSelect={handleSelect}
        trigger={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="attendee-add-btn"
          >
            참석자 추가
          </Button>
        }
      />
    </div>
  )
}
