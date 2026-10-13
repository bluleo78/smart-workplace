// src/calendar-tools.ts — 캘린더 읽기 도구 2종 + 초대 응답(RSVP) + 일정 생성·수정(WP-348). 두 앱 공유(#846, #855).
// 생성·수정(참석자 추가·제거 포함)은 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_* 확인 카드로 한다
// (경로마다 도구 하나 — ai-agent 프로필에는 create_event·update_event 를 싣지 않는다). 두 경로가 참석자 해석·시간대 보정·충돌 계산을
// 이 파일의 헬퍼(resolveAttendees·resolveAttendeeToRemove·normalizeTimezone·listConflicts)로 같이 쓴다. 일정 삭제는 계속 확인 카드만 한다.
import { z } from 'zod';
import { dropEmpty, omitKeys } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import { findMemberByUsername } from './member-tools.js';
import { errText } from './parse.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { CurrentUserClient } from './resolve.js';
import type { CalendarEventBody, CalendarToolClient, MemberRow, MemberToolClient } from './tool-client.js';

/**
 * 타임존 오프셋이 없는 naive datetime 에 Asia/Seoul(+09:00)을 붙인다(#393/#394).
 * 모델이 "2026-06-20T14:00:00" 처럼 오프셋 없이 보내면 서버 OffsetDateTime 파싱이 실패하므로 핸들러가 결정적으로 보정한다.
 * Z(UTC)나 ±HH:MM 이 이미 있으면 그대로 둔다. Zod 4 의 toJSONSchema 가 transform 을 지원하지 않아 스키마가 아닌 핸들러에서 적용한다.
 */
export function normalizeTimezone(val: string): string {
  if (/[Zz]$/.test(val) || /[+-]\d{2}:\d{2}$/.test(val)) return val;
  return val + '+09:00';
}

/** 확인 카드·생성 결과에 싣는 충돌 일정 — 사람이 알아볼 최소 필드만. */
export interface EventConflict {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
}

/** 참석자 해석 결과 — 초대할 user id(없으면 undefined)와 카드·결과 표시용 "이름(username)", 또는 교정 가능한 오류 문구. */
export type ResolvedAttendees = { ids?: number[]; names: string[] } | { error: string };

/**
 * 일정 초대 참석자 username → user id(#852). 확인 카드(propose_create_event·propose_add_attendees)와 직접 실행 도구(create_event·
 * update_event 의 addAttendees)가 같이 쓴다(WP-348). 구성원 조회는 테넌트 스코프라 찾히면 곧 초대 가능한 구성원이다. 못 찾거나
 * 비활성인 이름은 한 번에 모아 돌려준다 — 하나씩 고치며 여러 번 재호출하지 않게.
 * organizerId(요청자=주최자)는 서버가 주최자로 자동 포함하고 초대 목록에선 건너뛰므로 여기서도 뺀다 — 안 빼면 카드에만 초대로 보인다.
 * 외부 이메일 참석자는 지원하지 않는다(서버 CalendarEventRequest 가 user id 만 받는다).
 */
export async function resolveAttendees(
  client: Pick<MemberToolClient, 'searchMembers'>,
  usernames: string[] | undefined,
  organizerId: number,
): Promise<ResolvedAttendees> {
  const unique = [...new Set(usernames ?? [])];
  const found = await Promise.all(unique.map((u) => findMemberByUsername(client, u)));
  const missing: string[] = [];
  const inactive: string[] = [];
  const members: { userId: number; label: string }[] = [];
  found.forEach((m, i) => {
    if (!m) missing.push(unique[i]);
    else if (m.active === false) inactive.push(m.username);
    else if (m.userId !== organizerId) members.push({ userId: m.userId, label: `${m.name}(${m.username})` });
  });
  if (missing.length > 0 || inactive.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`찾을 수 없는 username: ${missing.join(', ')}`);
    if (inactive.length > 0) parts.push(`비활성 계정: ${inactive.join(', ')}`);
    return {
      error: `오류: 참석자를 확정하지 못했습니다(${parts.join(' / ')}). search_members 로 정확한 username 을 확인하세요. 외부 이메일 참석자는 지원하지 않습니다.`,
    };
  }
  // 초대할 사람이 없으면 ids 를 비워(undefined) 호출부가 조건 없이 그대로 싣게 한다.
  return { ids: members.length > 0 ? members.map((m) => m.userId) : undefined, names: members.map((m) => m.label) };
}

/** 초대할 사람이 주최자 본인뿐일 때의 오류 — 참석자 추가 카드와 update_event 가 같은 문구를 쓴다. */
export const NO_ATTENDEE_TO_ADD = '오류: 초대할 참석자가 없습니다(주최자 본인은 이미 참석자입니다).';

/**
 * 참석자에서 뺄 username → 구성원(#856). propose_remove_attendee 와 update_event 의 removeAttendees 가 같이 쓴다(WP-348).
 * 비활성 계정도 뺄 수 있어야 하므로 활성 여부는 보지 않는다(초대와 다르다). 서버는 주최자 본인 제거를 조용히 무시하므로 여기서 막는다 —
 * 아무 효과 없는 변경을 성공처럼 보이지 않게.
 */
export async function resolveAttendeeToRemove(
  client: Pick<MemberToolClient, 'searchMembers'>,
  username: string,
  organizerId: number,
): Promise<{ member: MemberRow } | { error: string }> {
  const member = await findMemberByUsername(client, username);
  if (!member) {
    return {
      error: `오류: username='${username}' 인 구성원을 찾을 수 없습니다. search_members 로 대상을 다시 찾아 정확한 username 을 확인하세요.`,
    };
  }
  if (member.userId === organizerId) return { error: '오류: 주최자 본인은 참석자에서 제거할 수 없습니다.' };
  return { member };
}

/**
 * [from,to) 와 겹치는 일정을 충돌 표시 형태로 조회한다(#395). listEvents 는 기간과 겹치는 일정을 돌려주므로 결과가 곧 충돌이다.
 * 확인 카드(propose_create_event)와 create_event 가 같이 쓴다. 조회 실패 처리(fail-open)는 호출부가 정한다.
 */
export async function listConflicts(
  client: Pick<CalendarToolClient, 'listEvents'>,
  from: string,
  to: string,
): Promise<EventConflict[]> {
  return (await client.listEvents(from, to)).map(({ id, title, startsAt, endsAt }) => ({ id, title, startsAt, endsAt }));
}

/** 서버 AttendeeResponse 중 뷰가 읽는 필드 — userId·invitedByUserId 는 숫자 사용자 ID 라 뷰에서 뺀다. */
interface AttendeeRaw {
  userId?: number | null;
  username?: string | null;
  name?: string | null;
  invitedByUserId?: number | null;
  [key: string]: unknown;
}

/**
 * 일정 상세 응답 → LLM 뷰(#833, WP-353). 참석자의 숫자 userId·invitedByUserId 를 내보내지 않는다.
 * 초대한 사람(invitedByUserId)은 같은 응답의 참석자 목록에서 username·name 을 찾아 `invitedBy` 로 바꾼다 — 추가 조회 없이 풀린다
 * (초대자는 보통 주최자라 참석자에 들어 있다). 목록에 없으면(예: 참석자에서 빠진 사람) 생략한다. 본인이 본인을 초대한 경우(주최자)도 생략한다.
 * 참석자가 없는 응답(생성 직후)은 참석자 가공만 건너뛴다.
 * 크기 정리(WP-353): UI 표시용 색(color·effectiveColor)·캘린더 id(calendarId)·생성 시각·외부 동기화 식별자(iCalUid)와 참석자 총원
 * (attendees 로 센다)를 빼고 값이 없는 키(null 설명·장소·반복 규칙·참석자의 externalEmail 등)를 지운다. 키가 없으면 값이 없는 것이다.
 * 반복 일정 수정에 쓰는 masterEventId·occurrenceDate 와 myRsvpStatus·myRole·external 은 그대로 둔다.
 */
export function toEventView<T extends { attendees?: AttendeeRaw[] | null }>(input: T): Record<string, unknown> {
  const event = input as T & Record<string, unknown>;
  const base = dropEmpty(omitKeys(event, 'color', 'effectiveColor', 'calendarId', 'createdAt', 'iCalUid', 'attendees', 'attendeeCount'));
  if (!Array.isArray(event.attendees)) {
    // 참석자 목록이 없는 응답은 총원을 알려 주는 attendeeCount 가 유일한 단서라 되돌려 둔다.
    return event.attendeeCount !== undefined ? { ...base, attendeeCount: event.attendeeCount } : base;
  }
  const people = new Map<number, { username: string | null; name: string | null }>();
  for (const a of event.attendees) {
    if (a.userId != null) people.set(a.userId, { username: a.username ?? null, name: a.name ?? null });
  }
  const attendees = event.attendees.map(({ userId, invitedByUserId, ...rest }) => {
    const inviter = invitedByUserId != null && invitedByUserId !== userId ? people.get(invitedByUserId) : undefined;
    return dropEmpty(inviter ? { ...rest, invitedBy: inviter } : rest);
  });
  return { ...base, attendees };
}

/** 캘린더 도구가 쓰는 클라이언트 — 참석자 username 해석(searchMembers)과 주최자(호출자) 확인(getMe)이 더 필요하다. */
export type CalendarToolsClient = CalendarToolClient & Pick<MemberToolClient, 'searchMembers'> & CurrentUserClient;

/** get_event 응답에서 update_event 가 읽는 필드 — 생략한 필드를 현재 값으로 채우고, 참석자 변경을 미리 검증한다. */
interface EventDetail {
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  color: string | null;
  reminderMinutes: number | null;
  recurrenceRule: string | null;
  attendees?: { userId: number | null; username?: string | null; name?: string | null; invitedByUserId?: number | null }[] | null;
}

export const listEventsInput = z.object({ from: z.string().min(1), to: z.string().min(1) });
export const getEventInput = z.object({ eventId: z.number().int().positive() });
// 서버 RsvpRequest.status 는 @NotNull 이 없어 null 이 통과한다 — 도구에서 필수 enum 으로 막는다.
export const rsvpEventInput = z.object({
  eventId: z.number().int().positive(),
  status: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']),
});

// WP-348: 일정 생성 — 확인 카드 propose_create_event 입력(summary 제외)에 알림 여부(notify)를 더했다.
// calendarId 는 받지 않는다 — 카드와 같이 기본 캘린더(항상 로컬, 외부 동기화 캘린더는 기본이 될 수 없다)에 만든다.
export const createEventInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string().min(1), // ISO-8601, 핸들러에서 타임존 보정
  endsAt: z.string().min(1),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  recurrenceRule: z.string().max(500).optional(),
  attendees: z.array(z.string().min(1)).optional(), // 초대할 구성원 username(주최자 본인은 넣지 않는다)
  notify: z.boolean().default(true), // 노출 기준 N — 초대 알림을 보낼지
});

// WP-348: 일정 수정 + 참석자 추가·제거(도구 수 원칙으로 한 도구에 합쳤다). 일정 필드는 부분 수정이다:
// 생략(또는 title·startsAt·endsAt·allDay 의 null)은 현재 값 유지, 비울 수 있는 필드의 null 은 비움(update_issue 의 parent 와 같은 규칙).
// null 이 "유지" 인 입력은 nullAsOmitted — 외부 MCP 정의에서는 null 갈래를 숨긴다(WP-340 웨이브 5). 비움에 쓰는 null 은 그대로 보인다.
const nullableToClear = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
export const updateEventInput = z.object({
  eventId: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: nullAsOmitted(z.string().min(1)), // ISO-8601, 반복 일정의 대상 회차 시작시각
  title: nullAsOmitted(z.string().min(1).max(200)),
  description: nullableToClear(z.string()),
  startsAt: nullAsOmitted(z.string().min(1)),
  endsAt: nullAsOmitted(z.string().min(1)),
  allDay: nullAsOmitted(z.boolean()),
  location: nullableToClear(z.string().max(200)),
  color: nullableToClear(z.string().max(32)),
  reminderMinutes: nullableToClear(z.number().int().min(0)),
  recurrenceRule: nullableToClear(z.string().max(500)),
  addAttendees: nullAsOmitted(z.array(z.string().min(1))), // 초대할 구성원 username
  removeAttendees: nullAsOmitted(z.array(z.string().min(1))), // 뺄 참석자 username
  notify: z.boolean().default(true), // 새 참석자에게 초대 알림을 보낼지
});

/** 캘린더 도구(list_events/get_event/rsvp_event/create_event/update_event). */
export function buildCalendarTools(client: CalendarToolsClient): SharedTool[] {
  return [
    {
      name: 'list_events',
      app: 'calendar',
      kind: 'read',
      description:
        'Lists my calendar (캘린더) events overlapping [from, to) (ISO-8601; no offset = +09:00). Recurring events appear per occurrence, with ' +
        'masterEventId and occurrenceDate.',
      inputSchema: listEventsInput,
      async handler(args) {
        const { from, to } = listEventsInput.parse(args);
        return JSON.stringify(await client.listEvents(normalizeTimezone(from), normalizeTimezone(to)));
      },
    },
    {
      name: 'get_event',
      app: 'calendar',
      kind: 'read',
      description:
        'Returns one event by eventId that I organize or am invited to (else not found), adding what list_events lacks: attendees, ' +
        'myRsvpStatus, myRole, external (synced from an external calendar).',
      inputSchema: getEventInput,
      async handler(args) {
        const { eventId } = getEventInput.parse(args);
        return JSON.stringify(toEventView((await client.getEvent(eventId)) as EventDetail));
      },
    },
    {
      name: 'rsvp_event',
      app: 'calendar',
      kind: 'write',
      // 응답을 덮어쓰고, 다시 불러도 주최자 알림이 또 쌓이므로 멱등이 아니다.
      hints: { destructive: true, idempotent: false },
      description:
        'Answers my event invitation (changeable later). Not found if I am not invited; externally synced events must be answered there. ' +
        'Notifies the organizer.',
      inputSchema: rsvpEventInput,
      async handler(args) {
        const { eventId, status } = rsvpEventInput.parse(args);
        await client.rsvpEvent(eventId, status);
        return 'ok';
      },
    },
    {
      name: 'create_event',
      app: 'calendar',
      kind: 'write',
      // 새 일정을 추가만 한다. 같은 인자로 다시 부르면 일정이 하나 더 생기고 초대 알림도 다시 가므로 멱등이 아니다(중복 방지 키 없음).
      // 생성은 늘 로컬 기본 캘린더라 외부 캘린더(M365)에 닿지 않는다.
      hints: { destructive: false, idempotent: false },
      description:
        'Creates an event in my default calendar (캘린더); each call creates a new one. startsAt/endsAt: ISO-8601 with offset (none = +09:00). ' +
        'attendees: member usernames from search_members (not me, no emails); notify:false skips their invitation notifications. recurrenceRule: ' +
        'RFC 5545 RRULE. Returns {event, conflicts?}; conflicts are my events already in that slot.',
      inputSchema: createEventInput,
      async handler(args) {
        const { attendees, notify, ...fields } = createEventInput.parse(args);
        // 참석자 username → user id. 확정 못 하면 만들지 않고 교정 가능한 사유를 돌려준다(확인 카드와 같은 해석).
        // 주최자(=호출자)를 빼려면 호출자 id 가 필요하다 — 참석자가 있을 때만 조회한다.
        let attendeeUserIds: number[] | undefined;
        if (attendees?.length) {
          const resolved = await resolveAttendees(client, attendees, (await client.getMe()).id);
          if ('error' in resolved) throw new Error(resolved.error);
          attendeeUserIds = resolved.ids;
        }
        const startsAt = normalizeTimezone(fields.startsAt);
        const endsAt = normalizeTimezone(fields.endsAt);
        // 충돌은 만들기 전에 조회한다 — 만든 뒤면 새 일정 자신이 충돌로 잡힌다. 조회 실패는 생성을 막지 않는다(fail-open, 카드와 같다).
        let conflicts: EventConflict[] = [];
        try {
          conflicts = await listConflicts(client, startsAt, endsAt);
        } catch {
          // fail-open: 충돌 정보 없이 진행한다.
        }
        const event = await client.createEvent({ ...fields, startsAt, endsAt, attendeeUserIds }, { notify });
        const eventView = toEventView(event as EventDetail);
        return JSON.stringify(conflicts.length > 0 ? { event: eventView, conflicts } : { event: eventView });
      },
    },
    {
      name: 'update_event',
      app: 'calendar',
      kind: 'write',
      // 기존 값을 덮어쓰고 참석자를 뺄 수 있다. 같은 인자로 다시 불러도 이후 회차 수정(THIS_AND_FOLLOWING)은 시리즈를 또 나누고
      // 참석자 추가는 오류가 나므로 멱등이 아니다. M365 에서 동기화된 내 일정은 수정·참석자 변경이 그 캘린더로 전송된다(openWorld).
      hints: { destructive: true, idempotent: false, openWorld: true },
      description:
        'Updates an event I organize and/or its attendees; only given fields change; null clears a nullable field (recurrenceRule:null ends ' +
        'recurrence). Recurring: scope ALL (default), THIS or THIS_AND_FOLLOWING; both need occurrenceDate (from list_events), and field ' +
        'changes also that occurrence\'s startsAt and endsAt. addAttendees/removeAttendees: member usernames (not the organizer, no emails), ' +
        'whole series; notify:false skips in-app invitations. Steps ' +
        'save independently ({ok, results}); attendee steps are skipped if fields fail.',
      inputSchema: updateEventInput,
      async handler(args) {
        const p = updateEventInput.parse(args);
        const { eventId, scope, notify } = p;
        const add = p.addAttendees ?? [];
        const remove = p.removeAttendees ?? [];
        const fieldKeys = [
          'title', 'description', 'startsAt', 'endsAt', 'allDay', 'location', 'color', 'reminderMinutes', 'recurrenceRule',
        ] as const;
        // title·startsAt·endsAt·allDay 는 비울 수 없어 null 을 생략으로 본다. 나머지는 null 도 변경(비움)이다.
        const keepOnNull = new Set<string>(['title', 'startsAt', 'endsAt', 'allDay']);
        const changesFields = fieldKeys.some((k) => (keepOnNull.has(k) ? p[k] != null : p[k] !== undefined));
        if (!changesFields && add.length === 0 && remove.length === 0) {
          throw new Error('바꿀 내용이 없습니다. 일정 필드나 addAttendees·removeAttendees 중 하나 이상을 주세요.');
        }

        // 1) 쓰기 전에 모두 검증·해석한다 — 오타 하나로 일정이 반쯤만 바뀌지 않게(update_issue 와 같은 순서).
        const cur = (await client.getEvent(eventId)) as EventDetail;
        const startsAt = p.startsAt != null ? normalizeTimezone(p.startsAt) : undefined;
        const endsAt = p.endsAt != null ? normalizeTimezone(p.endsAt) : undefined;
        // 반복 일정의 회차 수정에 마스터 시각을 채우면 그 회차가 시리즈 첫 회 시각으로 옮겨진다 — 회차 시각은 호출자가 줘야 한다.
        if (changesFields && scope !== 'ALL' && cur.recurrenceRule && (startsAt === undefined || endsAt === undefined)) {
          throw new Error('반복 일정의 THIS·THIS_AND_FOLLOWING 수정은 그 회차의 startsAt 과 endsAt 을 함께 주세요.');
        }
        const overlap = add.filter((u) => remove.includes(u));
        if (overlap.length > 0) throw new Error(`같은 사람을 추가하면서 제거할 수 없습니다: ${overlap.join(', ')}`);

        const organizerId = add.length > 0 || remove.length > 0 ? (await client.getMe()).id : undefined;
        const current = new Map((cur.attendees ?? []).filter((a) => a.userId != null).map((a) => [a.userId as number, a]));
        let addIds: number[] | undefined;
        if (add.length > 0) {
          const resolved = await resolveAttendees(client, add, organizerId!);
          if ('error' in resolved) throw new Error(resolved.error);
          if (!resolved.ids) throw new Error(NO_ATTENDEE_TO_ADD);
          // 확인 카드 사전검증(validateAttendeesAddable)과 같은 판정 — 이미 참석 중이면 행은 그대로이고 초대 알림만 다시 간다.
          const already = resolved.ids.filter((id) => current.has(id)).map((id) => current.get(id)!.username ?? String(id));
          if (already.length > 0) throw new Error(`이미 이 일정의 참석자입니다: ${already.join(', ')}`);
          addIds = resolved.ids;
        }
        const removeMembers: MemberRow[] = [];
        for (const username of [...new Set(remove)]) {
          const r = await resolveAttendeeToRemove(client, username, organizerId!);
          if ('error' in r) throw new Error(r.error);
          // 확인 카드 사전검증(validateAttendeeRemovable)과 같은 판정 — 참석자가 아니면 서버는 조용히 아무것도 하지 않는다.
          if (!current.has(r.member.userId)) throw new Error(`이 일정의 참석자가 아닙니다: ${username}`);
          removeMembers.push(r.member);
        }

        // 2) 단계별 실행 — 각 단계 독립, 결과를 구조화해 돌려준다.
        const results: Record<string, string> = {};
        const run = async (key: string, fn: () => Promise<unknown>) => {
          try {
            await fn();
            results[key] = 'ok';
          } catch (e) {
            results[key] = `failed: ${errText(e)}`;
          }
        };
        if (changesFields) {
          // 서버 수정은 전체 교체라 생략한 필드를 현재 값으로 채워 보낸다(참석자는 싣지 않는다 — 서버가 거절한다).
          const pick = <K extends (typeof fieldKeys)[number]>(k: K) => (p[k] !== undefined ? p[k] : cur[k]);
          const body: CalendarEventBody = {
            title: p.title ?? cur.title,
            description: pick('description'),
            startsAt: startsAt ?? cur.startsAt,
            endsAt: endsAt ?? cur.endsAt,
            allDay: p.allDay ?? cur.allDay,
            location: pick('location'),
            color: pick('color'),
            reminderMinutes: pick('reminderMinutes'),
            recurrenceRule: pick('recurrenceRule'),
          };
          const occurrenceDate = p.occurrenceDate != null ? normalizeTimezone(p.occurrenceDate) : undefined;
          await run('fields', () => client.updateEvent(eventId, body, { scope, occurrenceDate }));
        }
        // 필드 수정이 실패했으면 참석자 변경을 하지 않는다 — 초대 알림은 되돌릴 수 없어, 시각이 안 바뀐 일정의 초대가 나가면 안 된다.
        const fieldsFailed = results.fields !== undefined && results.fields !== 'ok';
        const attendeeStep = (key: string, fn: () => Promise<unknown>) =>
          fieldsFailed ? ((results[key] = 'skipped: fields failed'), Promise.resolve()) : run(key, fn);
        if (addIds) await attendeeStep('addAttendees', () => client.addEventAttendees(eventId, addIds, { notify }));
        for (const m of removeMembers) {
          await attendeeStep(`removeAttendee:${m.username}`, () => client.removeEventAttendee(eventId, m.userId));
        }
        const ok = Object.values(results).every((v) => v === 'ok');
        return JSON.stringify({ ok, results });
      },
    },
  ];
}
