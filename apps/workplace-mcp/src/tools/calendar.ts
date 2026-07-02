// src/tools/calendar.ts — 캘린더 도메인 도구. 읽기 전용이다(일정 생성/수정/삭제는 후속 태스크로
// 미룬다 — 일정 쓰기는 참석자 알림·충돌 계산 등 부수효과가 커서 별도 승인 흐름이 필요하기 때문).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 캘린더 도메인 도구 2종(list_events/get_event) 을 구성한다. */
export function buildCalendarTools(client: PatApiClient): McpTool[] {
  const listEventsInput = z.object({ from: z.string().min(1), to: z.string().min(1) });
  const getEventInput = z.object({ eventId: z.number().int() });

  return [
    {
      name: 'list_events',
      description: '지정한 기간(from~to, ISO 날짜/시각)의 일정을 JSON 목록으로 반환합니다.',
      inputSchema: listEventsInput,
      async handler(args) {
        const { from, to } = listEventsInput.parse(args);
        return JSON.stringify(await client.listEvents(from, to));
      },
    },
    {
      name: 'get_event',
      description: '일정 단건 상세를 JSON 으로 반환합니다.',
      inputSchema: getEventInput,
      async handler(args) {
        const { eventId } = getEventInput.parse(args);
        return JSON.stringify(await client.getEvent(eventId));
      },
    },
  ];
}
