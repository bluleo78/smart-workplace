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
  it('tools 는 읽기(list/get) + 생성/수정/삭제 제안(#333 M4) + 참석 응답 rsvp_event(유일한 직접 쓰기)', () => {
    expect(loaded['calendar-agent'].tools).toEqual([
      'mcp__workplace__list_events',
      'mcp__workplace__get_event',
      'mcp__workplace__propose_create_event',
      'mcp__workplace__propose_update_event',
      'mcp__workplace__propose_delete_event',
      'mcp__workplace__rsvp_event', // #855: 내 참석 응답(직접 실행)
      // #844: 참석자·수신자 이메일 조달 — 구성원 + 외부 연락처
      'mcp__workplace__search_members',
      'mcp__workplace__list_contacts',
      'mcp__workplace__submit_response',
    ]);
  });
  it('본문에 일정·확인 안내가 있고 maxTurns 가 설정됨', () => {
    expect(loaded['calendar-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['calendar-agent'].prompt).toContain('일정');
  });
});
