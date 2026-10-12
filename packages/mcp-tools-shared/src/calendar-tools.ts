// src/calendar-tools.ts — 캘린더 읽기 도구 2종 + 초대 응답(RSVP) + 일정 생성·수정(WP-348). 두 앱 공유(#846, #855).
// 생성·수정(참석자 추가·제거 포함)은 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_* 확인 카드로 한다
// (경로마다 도구 하나 — ai-agent 프로필에는 create_event·update_event 를 싣지 않는다). 두 경로가 참석자 해석·시간대 보정·충돌 계산을
// 이 파일의 헬퍼(resolveAttendees·resolveAttendeeToRemove·normalizeTimezone·listConflicts)로 같이 쓴다. 일정 삭제는 계속 확인 카드만 한다.
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import { findMemberByUsername } from './member-tools.js';
import { errText } from './parse.js';
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
  attendees?: { userId: number | null; username?: string | null }[] | null;
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
const nullableToClear = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
export const updateEventInput = z.object({
  eventId: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: z.string().min(1).nullish(), // ISO-8601, 반복 일정의 대상 회차 시작시각
  title: z.string().min(1).max(200).nullish(),
  description: nullableToClear(z.string()),
  startsAt: z.string().min(1).nullish(),
  endsAt: z.string().min(1).nullish(),
  allDay: z.boolean().nullish(),
  location: nullableToClear(z.string().max(200)),
  color: nullableToClear(z.string().max(32)),
  reminderMinutes: nullableToClear(z.number().int().min(0)),
  recurrenceRule: nullableToClear(z.string().max(500)),
  addAttendees: z.array(z.string().min(1)).nullish(), // 초대할 구성원 username
  removeAttendees: z.array(z.string().min(1)).nullish(), // 뺄 참석자 username
  notify: z.boolean().default(true), // 새 참석자에게 초대 알림을 보낼지
});

/** 캘린더 도구(list_events/get_event/rsvp_event/create_event/update_event). */
export function buildCalendarTools(client: CalendarToolsClient): SharedTool[] {
  return [
    {
      name: 'list_events',
      kind: 'read',
      description: '[from,to) 기간(ISO-8601)의 내 일정 목록을 JSON 으로 반환합니다. 일정 충돌 확인·요약에 사용하세요.',
      inputSchema: listEventsInput,
      async handler(args) {
        const { from, to } = listEventsInput.parse(args);
        return JSON.stringify(await client.listEvents(normalizeTimezone(from), normalizeTimezone(to)));
      },
    },
    {
      name: 'get_event',
      kind: 'read',
      description:
        '단일 일정 상세를 JSON 으로 반환합니다. 내가 만들었거나 참석자로 초대된 일정만 볼 수 있고(그 외에는 찾을 수 없음 오류), ' +
        'list_events 에는 없는 전체 참석자 목록(attendees)·내 응답(myRsvpStatus)·내 역할(myRole)·외부 캘린더 동기화 여부(external)가 담깁니다. ' +
        'eventId 는 list_events 결과 항목의 id 입니다.',
      inputSchema: getEventInput,
      async handler(args) {
        const { eventId } = getEventInput.parse(args);
        return JSON.stringify(await client.getEvent(eventId));
      },
    },
    {
      name: 'rsvp_event',
      kind: 'write',
      // 응답을 덮어쓰고, 다시 불러도 주최자 알림이 또 쌓이므로 멱등이 아니다.
      hints: { destructive: true, idempotent: false },
      description:
        '내가 초대받은 일정에 참석 응답을 합니다(ACCEPTED 참석 / DECLINED 불참 / TENTATIVE 미정). 주최자에게 알림이 갑니다. ' +
        '내 초대에만 응답할 수 있고(아니면 찾을 수 없음 오류), 외부 캘린더에서 동기화된 일정은 그 캘린더에서 응답해야 합니다. 응답은 다시 바꿀 수 있습니다.',
      inputSchema: rsvpEventInput,
      async handler(args) {
        const { eventId, status } = rsvpEventInput.parse(args);
        await client.rsvpEvent(eventId, status);
        return 'ok';
      },
    },
    {
      name: 'create_event',
      kind: 'write',
      // 새 일정을 추가만 한다. 같은 인자로 다시 부르면 일정이 하나 더 생기고 초대 알림도 다시 가므로 멱등이 아니다(중복 방지 키 없음).
      // 생성은 늘 로컬 기본 캘린더라 외부 캘린더(M365)에 닿지 않는다.
      hints: { destructive: false, idempotent: false },
      description:
        '내 기본 캘린더에 일정을 만듭니다. startsAt/endsAt 은 타임존 오프셋을 포함한 ISO-8601(예: 2026-06-20T14:00:00+09:00)로 주세요(오프셋이 없으면 +09:00 으로 봅니다). ' +
        'attendees 는 초대할 구성원 username 목록입니다(search_members 로 확인, 본인은 넣지 않음, 외부 이메일은 지원하지 않음). ' +
        'notify=false 면 참석자에게 초대 알림을 보내지 않습니다(기본 true). recurrenceRule 은 RFC5545 RRULE(예: FREQ=WEEKLY). ' +
        '결과는 { event, conflicts? } 이고, conflicts 는 같은 시간대에 이미 있던 내 일정입니다(생성은 막지 않음). 다시 부르면 일정이 또 생깁니다.',
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
        return JSON.stringify(conflicts.length > 0 ? { event, conflicts } : { event });
      },
    },
    {
      name: 'update_event',
      kind: 'write',
      // 기존 값을 덮어쓰고 참석자를 뺄 수 있다. 같은 인자로 다시 불러도 이후 회차 수정(THIS_AND_FOLLOWING)은 시리즈를 또 나누고
      // 참석자 추가는 오류가 나므로 멱등이 아니다. M365 에서 동기화된 내 일정은 수정·참석자 변경이 그 캘린더로 전송된다(openWorld).
      hints: { destructive: true, idempotent: false, openWorld: true },
      description:
        '내가 만든 일정을 수정하고 참석자를 추가·제거합니다. 일정 필드는 준 것만 바뀝니다(생략=현재 값 유지). ' +
        'description·location·color·reminderMinutes·recurrenceRule 은 null 로 비웁니다(recurrenceRule=null 이면 반복이 풀립니다). ' +
        '반복 일정은 scope 로 범위를 정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체, 기본 ALL). THIS·THIS_AND_FOLLOWING 은 ' +
        'occurrenceDate(대상 회차 시작시각)가 필요하고, 일정 필드를 바꿀 때는 그 회차의 startsAt·endsAt 도 주세요(생략한 다른 필드는 시리즈 값으로 채워집니다). ' +
        'addAttendees·removeAttendees 는 구성원 username 목록입니다(외부 이메일 불가, 주최자 본인은 뺄 수 없음). 참석자 변경은 scope 와 상관없이 일정(반복이면 시리즈) 전체에 적용됩니다. notify=false 면 새 참석자에게 초대 알림을 보내지 않습니다. ' +
        'M365 등에서 동기화된 일정은 그 캘린더에도 반영됩니다. eventId 는 list_events/get_event 결과의 id 입니다. 결과는 단계별 { ok, results } 입니다.',
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
        if (addIds) await run('addAttendees', () => client.addEventAttendees(eventId, addIds, { notify }));
        for (const m of removeMembers) {
          await run(`removeAttendee:${m.username}`, () => client.removeEventAttendee(eventId, m.userId));
        }
        const ok = Object.values(results).every((v) => v === 'ok');
        return JSON.stringify({ ok, results });
      },
    },
  ];
}
