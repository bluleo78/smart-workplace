// 일정 상세 보기 — 읽기 전용 일정(주최자 아님·외부 동기화 캘린더)을 입력칸 없이 아이콘 행으로 보여 준다 (WP-708).
// 예전엔 편집 폼을 그대로 쓰고 칸만 disabled 로 막아, 칸 11개·설명 칸 안쪽 스크롤·누를 수 없는 링크가 생겼다.
// Google·Outlook·Apple 처럼 보기와 편집을 나누고, 값이 없는 행(장소·알림·반복)은 행째 숨긴다.
// EventDialog 의 DialogContent 안에 들어가며, 본문만 스크롤되고 응답(RSVP) 줄은 아래에 붙어 있다.
import { AlignLeft, Bell, ChevronRight, Clock, MapPin, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { RsvpIcon } from '@/components/calendar/AttendeeSection'
import { CalendarTagAddButton, CalendarTagChip } from '@/components/calendar/CalendarTagChip'
import { CalendarTagPicker } from '@/components/calendar/CalendarTagPicker'
import { JoinMeetingButton } from '@/components/calendar/JoinMeetingButton'
import { RsvpControls } from '@/components/calendar/RsvpControls'
import { LinkedText } from '@/components/LinkedText'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AgentBadge } from '@/components/users/AgentBadge'
import { UserAvatar } from '@/components/users/UserAvatar'
import { eventDisplayColor } from '@/lib/calendar'
import type { ReadOnlyLabel } from '@/lib/calendarEventForm'
import {
  attendeeDisplayName,
  attendeeKey,
  eventTimeLines,
  isMeetingSeparatorLine,
  recurrenceLabel,
  reminderLabel,
  rsvpSummary,
  sortAttendeesForView,
  splitMeetingBoilerplate,
} from '@/lib/calendarEventView'
import { resolvePalette } from '@/lib/calendarPalette'
import { eventTagHint } from '@/lib/calendarTag'
import { hashString } from '@/lib/project-color'
import { CALENDAR_LINK_RULES } from '@/lib/textLinks'
import type { Attendee, CalendarEvent } from '@/types/calendar'

/** 제목 아래 칩(캘린더·읽기 전용 사유) 공통 모양 */
const CHIP_CLASS = 'inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground'

/** 참석자를 처음에 몇 명까지 펼쳐 보일지 — 넘으면 「외 N명 더 보기」로 접는다. */
const ATTENDEE_PREVIEW = 5

interface EventDetailViewProps {
  /** 상세 데이터(참석자 포함)가 있으면 그것, 없으면 목록 이벤트 */
  event: CalendarEvent
  /** 캘린더 칩 이름 — 내 캘린더 이름 또는 「초대받은 일정」. 캘린더 목록 로드 전이면 null(칩 숨김) */
  calendarLabel: string | null
  /** 읽기 전용 사유 칩(주최자만 수정 가능 / M365 동기화) */
  readOnlyLabel: ReadOnlyLabel | null
  /** 응답 버튼 노출 여부 — shouldShowRsvp 판정 결과 */
  showRsvp: boolean
  /** 참석자 목록에서 「(나)」 표시·정렬용 */
  myUserId: number | null | undefined
}

/** 아이콘 + 내용 한 행. 아이콘은 첫 줄 글자 높이에 맞춘다. */
function DetailRow({ icon, label, children, testId }: { icon: ReactNode; label: string; children: ReactNode; testId: string }) {
  return (
    <div className="flex items-start gap-3">
      {/* 아이콘은 꾸밈 — 무엇에 대한 행인지는 sr-only 라벨로 읽힌다 */}
      <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <div className="min-w-0 flex-1" data-testid={testId}>
        {children}
      </div>
    </div>
  )
}

/**
 * 접힌 Teams 안내문 본문 — 밑줄 구분선 줄은 가는 선으로, 나머지는 링크가 살아 있는 글로 그린다.
 * 구분선을 글자 그대로 두면 80자 밑줄이 좁은 화면에서 두 줄로 꺾여 지저분하다.
 */
function MeetingInfoText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) =>
        isMeetingSeparatorLine(line) ? (
          <span key={i} className="my-1.5 block border-t border-border" aria-hidden="true" />
        ) : (
          <span key={i} className="block min-h-[1lh]">
            <LinkedText text={line} rules={CALENDAR_LINK_RULES} />
          </span>
        ),
      )}
    </>
  )
}

/** 참석자 한 줄 — 아바타·이름(외부는 이메일)·(나)·주최자·AI 배지·응답 아이콘. */
function AttendeeRow({ attendee, isMe }: { attendee: Attendee; isMe: boolean }) {
  const name = attendeeDisplayName(attendee)
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm" data-testid="event-detail-attendee">
      {/* 아바타는 이름 옆 꾸밈 — 이름이 바로 옆에 있어 스크린리더가 두 번 읽지 않게 숨긴다.
          외부 참석자는 사용자 id 가 없어 이메일 해시로 색을 정한다(전부 같은 색이 되지 않게) */}
      <span aria-hidden="true" className="inline-flex">
        <UserAvatar user={{ id: attendee.userId ?? hashString(name), username: attendee.username ?? name, name }} size="xs" />
      </span>
      <span className="truncate">{name}</span>
      {isMe && <span className="shrink-0 text-muted-foreground">(나)</span>}
      {attendee.role === 'ORGANIZER' && (
        <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">주최자</span>
      )}
      {attendee.kind === 'AGENT' && <AgentBadge size="xs" />}
      <RsvpIcon status={attendee.rsvpStatus} className="h-3.5 w-3.5 shrink-0" />
    </li>
  )
}

/**
 * 읽기 전용 일정 상세 본문.
 * 제목(다이얼로그 제목) → 캘린더·사유 칩 → 시간 → 장소 → 참석자 → 알림 → 설명 순서. 응답 버튼은 아래에 고정.
 */
export function EventDetailView({ event, calendarLabel, readOnlyLabel, showRsvp, myUserId }: EventDetailViewProps) {
  const [showAllAttendees, setShowAllAttendees] = useState(false)
  // Teams 초대 안내문(밑줄 구분선 사이 덩어리) 펼침 — 기본은 접어 둔다
  const [showMeetingInfo, setShowMeetingInfo] = useState(false)

  const time = eventTimeLines(event)
  const recurrence = recurrenceLabel(event)
  const reminder = reminderLabel(event.reminderMinutes)
  const attendees = sortAttendeesForView(event.attendees ?? [], myUserId)
  const hiddenCount = Math.max(0, attendees.length - ATTENDEE_PREVIEW)
  const visibleAttendees = showAllAttendees ? attendees : attendees.slice(0, ATTENDEE_PREVIEW)
  const summary = rsvpSummary(attendees)
  // 설명에서 Teams 안내문을 떼어 접는다 — 참가 링크는 위 참가 버튼이 대신한다.
  // 서버가 회의를 찾지 못해 버튼이 없으면(onlineMeeting 없음) 접지 않는다: 안내문 속 참가 링크가 숨겨지면 들어갈 길이 사라진다.
  const description = event.description
    ? event.onlineMeeting
      ? splitMeetingBoilerplate(event.description)
      : { body: event.description, boilerplate: null }
    : null
  // 태그 — 응답에 없으면(구버전·모킹) 태그 없음·수정 불가로 본다(WP-714)
  const tags = event.tags ?? []
  const tagsEditable = event.tagsEditable ?? false
  // 칩 줄 아래 안내 — 붙일 수 있는 M365 일정은 「Outlook 범주에도 반영」, 붙일 수 없는 M365 일정은 「Outlook에서 바꾸기」 (WP-716)
  const tagHint = eventTagHint(event)

  return (
    <>
      {/* 본문만 스크롤 — 설명이 길어도 칸 안쪽이 아니라 다이얼로그 본문 하나가 스크롤된다 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-5" data-testid="event-detail-view">
        {/* 닫기(✕)는 DialogContent 오른쪽 위에 절대 배치 — 제목이 그 아래로 들어가지 않게 오른쪽 여백 */}
        <DialogHeader className="gap-2 pr-8 text-left">
          <DialogTitle className="text-lg leading-snug break-words break-keep" data-testid="event-detail-title">
            {event.title}
          </DialogTitle>
          <DialogDescription className="sr-only">일정 보기</DialogDescription>
          <div className="flex flex-wrap gap-1.5">
            {calendarLabel && (
              <span
                className={CHIP_CLASS}
                data-testid="event-detail-calendar"
              >
                <span className={`size-2 rounded-full ${resolvePalette(eventDisplayColor(event)).dotClass}`} aria-hidden="true" />
                {calendarLabel}
              </span>
            )}
            {readOnlyLabel && (
              <span
                data-testid={readOnlyLabel.testId}
                className={CHIP_CLASS}
              >
                {readOnlyLabel.text}
              </span>
            )}
            {/* 태그 칩은 같은 칩 줄에 이어 붙인다(넘치면 다음 줄). 붙일 수 있으면(앱 일정·내 Outlook 달력 일정) 끝에 「＋ 태그」 (WP-714·716, 시안 ②-A) */}
            {tags.map((t) => (
              <CalendarTagChip key={t.id} tag={t} />
            ))}
            {tagsEditable && (
              <CalendarTagPicker eventId={event.id} current={tags}>
                <CalendarTagAddButton data-testid="event-detail-tag-add" />
              </CalendarTagPicker>
            )}
          </div>
          {tagHint && (
            <p className="text-xs text-muted-foreground" data-testid="event-detail-tags-hint">
              {tagHint}
            </p>
          )}
          {/* 회의 참가 — 일정을 여는 이유가 대개 「들어가기」라 칩 줄 바로 아래 넓은 버튼으로 둔다 (WP-710) */}
          {event.onlineMeeting && <JoinMeetingButton onlineMeeting={event.onlineMeeting} testId="event-detail-join" />}
        </DialogHeader>

        <div className="mt-5 space-y-4 text-sm">
          <DetailRow icon={<Clock className="h-4 w-4" />} label="시간" testId="event-detail-time">
            {/* 넓은 화면은 「날짜 · 시각」 한 줄, 휴대폰은 두 줄 */}
            <div>
              <span>{time.date}</span>
              {time.time && (
                <>
                  <span className="hidden sm:inline"> · </span>
                  <span className="block sm:inline">{time.time}</span>
                </>
              )}
            </div>
            {recurrence && (
              <div className="text-muted-foreground" data-testid="event-detail-recurrence">
                {recurrence}
              </div>
            )}
          </DetailRow>

          {event.location && (
            <DetailRow icon={<MapPin className="h-4 w-4" />} label="장소" testId="event-detail-location">
              <span className="break-words">{event.location}</span>
            </DetailRow>
          )}

          {attendees.length > 0 && (
            <DetailRow icon={<Users className="h-4 w-4" />} label="참석자" testId="event-detail-attendees">
              <div>
                참석자 {attendees.length}명
                {summary && <span className="text-muted-foreground"> · {summary}</span>}
              </div>
              <ul className="mt-2 space-y-1.5">
                {visibleAttendees.map((a, i) => (
                  <AttendeeRow
                    key={attendeeKey(a, i)}
                    attendee={a}
                    isMe={myUserId != null && a.userId === myUserId}
                  />
                ))}
              </ul>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="mt-1.5 text-sm text-primary hover:underline"
                  onClick={() => setShowAllAttendees((v) => !v)}
                  aria-expanded={showAllAttendees}
                  data-testid="event-detail-attendees-toggle"
                >
                  {showAllAttendees ? '접기' : `외 ${hiddenCount}명 더 보기`}
                </button>
              )}
            </DetailRow>
          )}

          {reminder && (
            <DetailRow icon={<Bell className="h-4 w-4" />} label="알림" testId="event-detail-reminder">
              {reminder}
            </DetailRow>
          )}

          {description && (
            <DetailRow icon={<AlignLeft className="h-4 w-4" />} label="설명" testId="event-detail-description">
              {description.body && (
                <p className="whitespace-pre-wrap break-words text-foreground/90">
                  <LinkedText text={description.body} rules={CALENDAR_LINK_RULES} />
                </p>
              )}
              {description.boilerplate && (
                <div className={description.body ? 'mt-2' : undefined}>
                  <button
                    type="button"
                    className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setShowMeetingInfo((v) => !v)}
                    aria-expanded={showMeetingInfo}
                    data-testid="event-detail-meeting-info-toggle"
                  >
                    <ChevronRight
                      className={`h-4 w-4 transition-transform ${showMeetingInfo ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                    Teams 회의 안내
                  </button>
                  {showMeetingInfo && (
                    <div
                      className="mt-1 break-words text-xs text-muted-foreground"
                      data-testid="event-detail-meeting-info"
                    >
                      <MeetingInfoText text={description.boilerplate} />
                    </div>
                  )}
                </div>
              )}
            </DetailRow>
          )}
        </div>
      </div>

      {/* 응답 줄 — 본인이 참석자인 우리 앱 일정만(M365 일정 응답은 Outlook 에서). 스크롤 밖에 붙어 있다.
          myRsvpStatus 확인은 shouldShowRsvp 가 이미 했지만 RsvpControls 의 current 타입을 좁히려고 다시 본다 */}
      {showRsvp && event.myRsvpStatus && (
        <div className="flex flex-wrap items-center gap-2 border-t px-6 py-3" data-testid="event-detail-rsvp">
          <span className="mr-auto text-sm text-muted-foreground">참석하나요?</span>
          <RsvpControls eventId={event.id} current={event.myRsvpStatus} />
        </div>
      )}
    </>
  )
}
