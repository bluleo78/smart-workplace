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
  it('tools 는 읽기(search/get)+쓰기(create/update/move)+삭제 제안(#856)', () => {
    expect(loaded['wiki-agent'].tools).toEqual([
      'mcp__workplace__list_wiki_spaces',
      'mcp__workplace__search_wiki',
      'mcp__workplace__get_wiki_page',
      'mcp__workplace__list_wiki_pages', // #850: 페이지 트리
      'mcp__workplace__get_wiki_backlinks', // #850: 백링크
      'mcp__workplace__create_wiki_page',
      'mcp__workplace__update_wiki_page',
      'mcp__workplace__move_wiki_page', // #855: 페이지 이동
      'mcp__workplace__propose_delete_wiki_page', // #856: 페이지 삭제 제안
      'mcp__workplace__submit_response',
    ]);
  });
  // WP-309: 일부 수정 요청에 노트 전체를 다시 쓰며 공백을 정규화하고 사람 텍스트를 지운 사례 — 범위 밖 원문 복사 규칙을 고정한다.
  it('수정 시 요청 범위 밖 블록은 읽은 그대로 바이트 단위 복사(정규화·삭제 금지)를 지시한다 (WP-309)', () => {
    const prompt = loaded['wiki-agent'].prompt;
    expect(prompt).toContain('바이트 단위 그대로');
    expect(prompt).toContain('정규화하지 마세요');
  });
  it('maxTurns 설정 + 본문에 노트·버전 안내', () => {
    expect(loaded['wiki-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['wiki-agent'].prompt).toContain('노트');
  });
});
