import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('wiki-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 wiki-agent 가 로드된다', () => {
    expect(loaded['wiki-agent']).toBeDefined();
  });
  it('tools 는 읽기(search/get)+쓰기(create/update)', () => {
    expect(loaded['wiki-agent'].tools).toEqual([
      'mcp__workplace__list_wiki_spaces',
      'mcp__workplace__search_wiki',
      'mcp__workplace__get_wiki_page',
      'mcp__workplace__create_wiki_page',
      'mcp__workplace__update_wiki_page',
      'mcp__workplace__submit_response',
    ]);
  });
  it('maxTurns 설정 + 본문에 노트·버전 안내', () => {
    expect(loaded['wiki-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['wiki-agent'].prompt).toContain('노트');
  });
});
