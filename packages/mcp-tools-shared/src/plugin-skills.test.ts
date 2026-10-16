import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { wireInputSchema } from './tool-definitions.js';

/**
 * genia-works 플러그인 스킬(plugins/genia-works/skills)이 부르라고 적은 도구·인자가 실제 공유 도구 정의에 있는지(WP-419).
 * 스킬은 외부 Claude Code 에 그대로 배포되므로, 여기서 도구 이름·입력을 바꾸면 스킬도 함께 고치도록 이 테스트가 깨진다.
 */
// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = new Map(buildSharedTools({} as unknown as SharedToolClient).map((t) => [t.name, t]));
const skill = (name: string) => readFileSync(new URL(`../../../plugins/genia-works/skills/${name}/SKILL.md`, import.meta.url), 'utf8');

/** 도구의 입력 필드 이름(외부 MCP 에 나가는 JSON 스키마 기준). */
const inputFields = (name: string) => Object.keys((wireInputSchema(tools.get(name)!.inputSchema).properties ?? {}) as object);

describe('work-on 스킬', () => {
  const body = skill('work-on');

  // 백틱 안에서 `도구(…)` 로 부르거나 `도구` 로만 적은 snake_case 이름 — 스킬이 부르라고 한 도구.
  const called = new Set([...body.matchAll(/`([a-z]+(?:_[a-z0-9]+)+)[`(]/g)].map((m) => m[1]));

  it('스킬이 적은 도구는 모두 외부 MCP 로 나가는 공유 도구다', () => {
    expect(called.size).toBeGreaterThan(0);
    expect([...called].filter((n) => !tools.has(n))).toEqual([]);
    // workplace-mcp 는 destructive 도구를 내보내지 않는다(exposableTools) — 스킬이 그런 도구를 부르면 외부 사용자에게는 없다.
    expect([...called].filter((n) => tools.get(n)?.kind === 'destructive')).toEqual([]);
  });

  it('스킬이 쓰는 인자는 그 도구의 입력에 있다', () => {
    const uses: Record<string, string[]> = {
      get_issue_detail: ['issueKey'],
      list_issues: ['parent', 'assignee', 'pendingForMe'],
      report_agent_work: ['issueKey', 'state', 'note', 'message', 'stepsDone', 'stepsTotal'],
      update_issue: ['issueKey', 'assignees', 'status'],
      get_issue_chat: ['issueKey', 'after'],
      read_file: ['source', 'issueKey', 'messageId', 'attachmentId'],
    };
    for (const [tool, fields] of Object.entries(uses)) {
      expect(called.has(tool), tool).toBe(true);
      expect(inputFields(tool), tool).toEqual(expect.arrayContaining(fields));
    }
  });
});
