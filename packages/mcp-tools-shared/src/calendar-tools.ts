// src/calendar-tools.ts — 캘린더 읽기 도구 2종 + 초대 응답(RSVP). 두 앱 공유(#846, #855).
// 일정 생성·수정·삭제·참석자 변경은 다른 사람에게 영향이 나가 ai-agent 의 propose_* (확인 카드)만 한다.
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import type { CalendarToolClient } from './tool-client.js';

/**
 * 타임존 오프셋이 없는 naive datetime 에 Asia/Seoul(+09:00)을 붙인다(#393/#394).
 * 모델이 "2026-06-20T14:00:00" 처럼 오프셋 없이 보내면 서버 OffsetDateTime 파싱이 실패하므로 핸들러가 결정적으로 보정한다.
 * Z(UTC)나 ±HH:MM 이 이미 있으면 그대로 둔다. Zod 4 의 toJSONSchema 가 transform 을 지원하지 않아 스키마가 아닌 핸들러에서 적용한다.
 */
export function normalizeTimezone(val: string): string {
  if (/[Zz]$/.test(val) || /[+-]\d{2}:\d{2}$/.test(val)) return val;
  return val + '+09:00';
}

export const listEventsInput = z.object({ from: z.string().min(1), to: z.string().min(1) });
export const getEventInput = z.object({ eventId: z.number().int().positive() });
// 서버 RsvpRequest.status 는 @NotNull 이 없어 null 이 통과한다 — 도구에서 필수 enum 으로 막는다.
export const rsvpEventInput = z.object({
  eventId: z.number().int().positive(),
  status: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']),
});

/** 캘린더 도구(list_events/get_event/rsvp_event). */
export function buildCalendarTools(client: CalendarToolClient): SharedTool[] {
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
      description: '단일 일정 상세를 JSON 으로 반환합니다. eventId 는 list_events 결과 항목의 id 입니다.',
      inputSchema: getEventInput,
      async handler(args) {
        const { eventId } = getEventInput.parse(args);
        return JSON.stringify(await client.getEvent(eventId));
      },
    },
    {
      name: 'rsvp_event',
      kind: 'write',
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
  ];
}
