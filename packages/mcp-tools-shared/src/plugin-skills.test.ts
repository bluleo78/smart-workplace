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
  report_agent_work: ['issueKey', 'state', 'note', 'message', 'stepsDone', 'stepsTotal', 'fileIds'],
  update_issue: ['issueKey', 'assignees'],
  upload_file: ['name'],
  get_issue_chat: ['issueKey', 'after'],
  read_file: ['source', 'issueKey', 'messageId', 'attachmentId'],
});

// start-agent 는 MCP 도구를 부르지 않는다 — 고른 AI 의 키로 스크립트(gw-agent-projects)가 REST 목록을 읽는다(WP-1046).

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
// WP-453: 담당을 바꾼 이유를 남기는 댓글(add_comment). WP-455: 맡길 AI 를 설명으로 고르는 구성원 찾기(search_members).
// WP-516: 근거 이미지·파일을 올려(upload_file) 결함 이슈(create_issue)나 질문·보고 글(report_agent_work)에 fileIds 로 붙인다.
// WP-800: 할 일이 없으면 대기열 라벨 이슈(list_issues label)를 가져가고(claim_issue), 넘길 때는 AI 대신 라벨(labels)을 붙인다.
// WP-719: 담당 밖 이슈의 멘션(list_issues mentionsMe)에 물은 곳에서 답한다(add_issue_chat).
describeSkillTools('work-loop', {
  get_member: ['username'],
  list_issues: ['projectKey', 'assignee', 'status', 'parent', 'pendingForMe', 'mentionsMe', 'reporter', 'createdFrom', 'createdTo', 'q', 'label'],
  report_agent_work: ['issueKey', 'state', 'note', 'message', 'stepsDone', 'stepsTotal', 'nextRunAt', 'fileIds'],
  get_issue_chat: ['issueKey', 'after'],
  update_issue: ['issueKey', 'assignees', 'status', 'labels'],
  get_issue_detail: ['issueKey'],
  create_issue: ['projectKey', 'title', 'body', 'priority', 'dueDate', 'assignees', 'parent', 'fileIds', 'labels'],
  upload_file: ['name'],
  add_comment: ['issueKey', 'body'],
  search_members: ['kind'],
  claim_issue: ['issueKey', 'queueLabel'],
  add_issue_chat: ['issueKey', 'body'],
});
