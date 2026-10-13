import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('calendar-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 calendar-agent 가 로드된다', () => {
    expect(loaded['calendar-agent']).toBeDefined();
  });
  it('tools 는 읽기(list/get) + 생성/수정/삭제 제안(#333 M4) + 참석자 추가/제거 제안(#856) + 참석 응답 rsvp_event(유일한 직접 쓰기)', () => {
    expect(loaded['calendar-agent'].tools).toEqual([
      'mcp__workplace__list_events',
      'mcp__workplace__get_event',
      'mcp__workplace__propose_create_event',
      'mcp__workplace__propose_update_event',
      'mcp__workplace__propose_delete_event',
      // #856: 기존 일정 참석자 추가·제거 제안
      'mcp__workplace__propose_add_attendees',
      'mcp__workplace__propose_remove_attendee',
      'mcp__workplace__rsvp_event', // #855: 내 참석 응답(직접 실행)
      // #844: 참석자·수신자 이메일 조달 — 구성원 + 외부 연락처
      'mcp__workplace__search_members',
      'mcp__workplace__list_contacts',
      'mcp__workplace__submit_response',
    ]);
  });
  // WP-357: 캘린더 목록 도구는 두지 않았다(calendarId 를 받는 도구가 없다) — 모델이 없는 도구를 지어 부르지 않게 알린다.
  it('캘린더 목록 도구가 없고 일정은 기본 캘린더에 만들어진다고 안내한다 (WP-357)', () => {
    const prompt = loaded['calendar-agent'].prompt;
    expect(prompt).toContain('별도 조회 도구는 없습니다');
    expect(prompt).toContain('`calendarName`');
  });
  it('본문에 일정·확인 안내가 있고 maxTurns 가 설정됨', () => {
    expect(loaded['calendar-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['calendar-agent'].prompt).toContain('일정');
  });
});
