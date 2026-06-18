import { describe, it, expect } from 'vitest';
import { checkSubagentWhitelist } from './tool-policy.js';

const allowed = ['issue-agent'];

describe('checkSubagentWhitelist', () => {
  it('허용 목록에 있는 subagent_type 은 통과(null)', () => {
    expect(checkSubagentWhitelist('Agent', { subagent_type: 'issue-agent' }, allowed)).toBeNull();
  });

  it('general-purpose 위임은 차단', () => {
    const r = checkSubagentWhitelist('Agent', { subagent_type: 'general-purpose' }, allowed);
    expect(r).toMatch(/general-purpose|not an allowed/);
  });

  it('미정의 타입은 차단', () => {
    expect(checkSubagentWhitelist('Agent', { subagent_type: 'unknown-agent' }, allowed)).not.toBeNull();
  });

  it('빈/공백 subagent_type 은 차단(타입 생략 우회 방지)', () => {
    expect(checkSubagentWhitelist('Agent', { subagent_type: '' }, allowed)).not.toBeNull();
    expect(checkSubagentWhitelist('Agent', { subagent_type: '   ' }, allowed)).not.toBeNull();
    expect(checkSubagentWhitelist('Agent', {}, allowed)).not.toBeNull();
  });

  it('Agent 가 아닌 도구는 검사 대상 아님(null)', () => {
    expect(checkSubagentWhitelist('mcp__workplace__get_issue_detail', { issueKey: 'X-1' }, allowed)).toBeNull();
  });

  it('input 미전달이면 검사 생략(null) — 파싱 노이즈 방어', () => {
    expect(checkSubagentWhitelist('Agent', undefined, allowed)).toBeNull();
  });
});
