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
  it('tools 는 읽기+내부쓰기+삭제제안', () => {
    expect(loaded['contacts-agent'].tools).toEqual([
      'mcp__workplace__list_contacts',
      'mcp__workplace__get_external_contact',
      'mcp__workplace__create_external_contact',
      'mcp__workplace__update_external_contact',
      'mcp__workplace__propose_delete_contact',
    ]);
  });
  it('maxTurns 설정 + 본문에 연락처·삭제 안내', () => {
    expect(loaded['contacts-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['contacts-agent'].prompt).toMatch(/연락처|삭제/);
  });
});
