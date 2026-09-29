import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('contacts-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 contacts-agent 가 로드된다', () => {
    expect(loaded['contacts-agent']).toBeDefined();
  });
  it('tools 는 읽기+내부쓰기+삭제제안 + 즐겨찾기·facets·사용자 그룹(#839)', () => {
    expect(loaded['contacts-agent'].tools).toEqual([
      'mcp__workplace__list_contacts',
      'mcp__workplace__get_external_contact',
      'mcp__workplace__create_external_contact',
      'mcp__workplace__update_external_contact',
      'mcp__workplace__propose_delete_contact',
      'mcp__workplace__get_contact_facets',
      'mcp__workplace__add_contact_favorite',
      'mcp__workplace__remove_contact_favorite',
      'mcp__workplace__search_members',
      'mcp__workplace__list_user_groups',
      'mcp__workplace__get_user_group',
      'mcp__workplace__create_user_group',
      'mcp__workplace__update_user_group',
      'mcp__workplace__add_user_group_member',
      'mcp__workplace__remove_user_group_member',
      'mcp__workplace__propose_delete_user_group',
      'mcp__workplace__submit_response',
    ]);
  });
  it('#839: force 는 사용자 확인 후에만, 그룹 삭제는 제안으로만 안내한다', () => {
    const prompt = loaded['contacts-agent'].prompt;
    expect(prompt).toMatch(/force: true/);
    expect(prompt).toMatch(/확인받은 경우에만/);
    expect(prompt).toMatch(/propose_delete_user_group/);
  });
  it('maxTurns 설정 + 본문에 연락처·삭제 안내', () => {
    expect(loaded['contacts-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['contacts-agent'].prompt).toMatch(/연락처|삭제/);
  });
  it('"추가" 표현 구분 규칙: update_external_contact + create_external_contact 양 경로 명시', () => {
    const prompt = loaded['contacts-agent'].prompt;
    // "추가" 필드 수정 → update 경로 명시
    expect(prompt).toMatch(/update_external_contact/);
    // 동명이인 → 확인 후 처리 규칙 명시
    expect(prompt).toMatch(/동명이인/);
    // create 는 신규 생성 전용(기존 수정에 금지) 명시
    expect(prompt).toMatch(/create_external_contact.*금지|금지.*create_external_contact/s);
  });
});
