import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { wireInputSchema } from './tool-definitions.js';

/**
 * genia-works 플러그인 스킬(plugins/genia-works/skills)이 부르라고 적은 도구·인자가 실제 공유 도구 정의에 있는지(WP-419).
 * 스킬은 외부 Claude Code 에 그대로 배포되므로, 여기서 도구 이름·입력을 바꾸면 스킬도 함께 고치도록 이 테스트가 깨진다.
 */
// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = new Map(buildSharedTools({} as unknown as SharedToolClient).map((t) => [t.name, t]));
// 스킬 폴더의 모든 .md(SKILL.md + 참고 파일)를 이어 붙인다 — 스킬이 참고 파일에 적은 도구도 함께 검사하려는 것(WP-376).
const skill = (name: string) => {
  const dir = new URL(`../../../plugins/genia-works/skills/${name}/`, import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n');
};

// 백틱 안에서 `도구(…)` 로 부르거나 `도구` 로만 적은 snake_case 이름 — 스킬이 부르라고 한 도구.
const calledTools = (body: string) => new Set([...body.matchAll(/`([a-z]+(?:_[a-z0-9]+)+)[`(]/g)].map((m) => m[1]));

/** 도구의 입력 필드 이름(외부 MCP 에 나가는 JSON 스키마 기준). */
const inputFields = (name: string) => Object.keys((wireInputSchema(tools.get(name)!.inputSchema).properties ?? {}) as object);

/** 스킬이 적은 도구가 모두 외부로 나가는 공유 도구인지, 표에 적은 인자가 그 도구의 입력에 있는지 — 스킬마다 같은 두 검사. */
function describeSkillTools(name: string, uses: Record<string, string[]>) {
  describe(`${name} 스킬`, () => {
    it('스킬이 적은 도구는 모두 외부 MCP 로 나가는 공유 도구다', () => {
      const called = calledTools(skill(name));
      expect(called.size).toBeGreaterThan(0);
      expect([...called].filter((n) => !tools.has(n))).toEqual([]);
      // workplace-mcp 는 destructive 도구를 내보내지 않는다(exposableTools) — 스킬이 그런 도구를 부르면 외부 사용자에게는 없다.
      expect([...called].filter((n) => tools.get(n)?.kind === 'destructive')).toEqual([]);
    });

    it('스킬이 쓰는 인자는 그 도구의 입력에 있다', () => {
      const called = calledTools(skill(name));
      for (const [tool, fields] of Object.entries(uses)) {
        expect(called.has(tool), tool).toBe(true);
        expect(inputFields(tool), tool).toEqual(expect.arrayContaining(fields));
      }
    });
  });
}

describeSkillTools('work-on', {
  get_issue_detail: ['issueKey'],
  list_issues: ['parent', 'assignee', 'pendingForMe'],
  report_agent_work: ['issueKey', 'state', 'note', 'message', 'stepsDone', 'stepsTotal'],
  update_issue: ['issueKey', 'assignees'],
  get_issue_chat: ['issueKey', 'after'],
  read_file: ['source', 'issueKey', 'messageId', 'attachmentId'],
});

// WP-449: work-on 의 짝 — 결과 요약을 남기며 작업을 끝내고(검토 대기·완료 뒤 DONE·취소·반려·실패) 리소스를 정리하는 스킬.
describeSkillTools('work-done', {
  get_issue_detail: ['issueKey'],
  get_issue_chat: ['issueKey'],
  list_issues: ['parent', 'assignee', 'status'],
  report_agent_work: ['issueKey', 'state', 'note', 'message'],
  update_issue: ['issueKey', 'status'],
});

// WP-376: 할당된 이슈를 하나씩 처리하는 스킬 — 신원 확인(get_member me)·후보 고르기·하위 맡기·질문과 답에 쓰는 도구.
// WP-451: 본문 지시 회차 — 다음 회차 대기(nextRunAt), 만들기 전 찾기(reporter·createdFrom·createdTo·q), 하위·결함 만들기, 닫기(status).
// WP-453: 담당을 바꾼 이유를 남기는 댓글(add_comment).
describeSkillTools('work-loop', {
  get_member: ['username'],
  list_issues: ['projectKey', 'assignee', 'status', 'parent', 'pendingForMe', 'reporter', 'createdFrom', 'createdTo', 'q'],
  report_agent_work: ['issueKey', 'state', 'note', 'message', 'stepsDone', 'stepsTotal', 'nextRunAt'],
  get_issue_chat: ['issueKey', 'after'],
  update_issue: ['issueKey', 'assignees', 'status'],
  get_issue_detail: ['issueKey'],
  create_issue: ['projectKey', 'title', 'body', 'priority', 'dueDate', 'assignees', 'parent'],
  add_comment: ['issueKey', 'body'],
});
