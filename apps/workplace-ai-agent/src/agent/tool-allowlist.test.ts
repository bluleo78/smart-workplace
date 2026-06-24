import { describe, expect, it } from 'vitest';
import { BASE_DISALLOWED, computeToolPolicy } from './tool-allowlist.js';

describe('computeToolPolicy', () => {
  it('기본(플래그 없음): mcp 와일드카드만 allowed, Read·Agent 는 disallowed', () => {
    const { allowed, disallowed } = computeToolPolicy({});
    expect(allowed).toEqual(['mcp__workplace__*']);
    expect(disallowed).toContain('Read');
    expect(disallowed).toContain('Agent');
  });

  it('allowFileRead=true: Read 가 allowed 로 이동하고 disallowed 에서 제외', () => {
    const { allowed, disallowed } = computeToolPolicy({ allowFileRead: true });
    expect(allowed).toContain('Read');
    expect(allowed).toContain('mcp__workplace__*');
    expect(disallowed).not.toContain('Read');
  });

  it('allowSubagents=true: Agent 가 allowed 로 이동하고 disallowed 에서 제외(Task 는 유지)', () => {
    const { allowed, disallowed } = computeToolPolicy({ allowSubagents: true });
    expect(allowed).toContain('Agent');
    expect(disallowed).not.toContain('Agent');
    expect(disallowed).toContain('Task');
  });

  it('BASE_DISALLOWED 는 SlashCommand 를 포함하지 않는다(#457)', () => {
    expect(BASE_DISALLOWED).not.toContain('SlashCommand');
  });
});
