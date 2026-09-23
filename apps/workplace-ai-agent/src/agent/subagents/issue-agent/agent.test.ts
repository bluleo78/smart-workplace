import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('issue-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);

  it('loadSubagents 로 issue-agent 가 로드된다', () => {
    expect(loaded['issue-agent']).toBeDefined();
  });

  it('tools 는 이슈 MCP 도구 + #371 list_issues + 신규 create/update_issue/edit_comment 를 포함한다', () => {
    expect(loaded['issue-agent'].tools).toEqual([
      'mcp__workplace__list_issues',
      'mcp__workplace__get_issue_detail',
      'mcp__workplace__update_status',
      'mcp__workplace__add_comment',
      'mcp__workplace__edit_comment',
      'mcp__workplace__create_issue',
      'mcp__workplace__update_issue',
      'mcp__workplace__unassign_self',
      // #844: 의존관계 쓰기 + 쓰기 값 조달용 조회(유형·라벨, 사람 username)
      'mcp__workplace__add_issue_dependency',
      'mcp__workplace__remove_issue_dependency',
      'mcp__workplace__get_project',
      'mcp__workplace__search_members',
      'mcp__workplace__submit_response',
    ]);
  });

  it('maxTurns=20, description·본문이 비어있지 않다', () => {
    expect(loaded['issue-agent'].maxTurns).toBe(20);
    expect(loaded['issue-agent'].description.length).toBeGreaterThan(0);
    expect(loaded['issue-agent'].prompt).toContain('이슈');
  });
});
