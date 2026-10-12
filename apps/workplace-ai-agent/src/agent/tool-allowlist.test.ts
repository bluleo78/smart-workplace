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

  // WP-351: SDK 0.3.x 는 위임 도구를 Task 로도 부르고 'Task' 거부가 Agent 도구를 숨긴다(실측) — 위임을 열면 Task 도 뺀다.
  it('allowSubagents=true: Agent 가 allowed 로 이동하고 Agent·Task 를 disallowed 에서 제외(TaskCreate 등은 유지)', () => {
    const { allowed, disallowed } = computeToolPolicy({ allowSubagents: true });
    expect(allowed).toContain('Agent');
    expect(disallowed).not.toContain('Agent');
    expect(disallowed).not.toContain('Task');
    expect(disallowed).toEqual(expect.arrayContaining(['TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate']));
  });

  it('위임을 열지 않으면 Task 는 계속 막는다', () => {
    expect(computeToolPolicy({}).disallowed).toContain('Task');
  });

  it('BASE_DISALLOWED 는 SlashCommand 를 포함하지 않는다(#457)', () => {
    expect(BASE_DISALLOWED).not.toContain('SlashCommand');
  });
});
