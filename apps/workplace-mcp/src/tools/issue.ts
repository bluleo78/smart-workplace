// src/tools/issue.ts — 이슈 도메인 도구. 사용자 본인 권한으로 직접 실행된다.
// 공유 7종(get_issue_detail/create_issue/update_issue/add_comment/edit_comment/add·remove_issue_dependency)은
// @smart-workplace/issue-tools-shared 의 buildSharedIssueTools 를 쓰고, PAT 전용 3종(list_projects/get_project/
// list_issues)만 여기서 정의한다.
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import {
  buildSharedIssueTools,
  defaultListAssignee,
  parseIssueKey,
  type IssueToolClient,
  type McpTool,
} from '@smart-workplace/issue-tools-shared';

/** PatApiClient(projectKey/number 기준, PAT 신원)를 공유 IssueToolClient(issueKey 기준)로 어댑팅.
 * add/edit_comment 의 코멘트 id 해석(getIssueDetail→summary.id)도 여기서 흡수한다. */
function buildIssueToolClient(client: PatApiClient): IssueToolClient {
  return {
    getProjectTypes: (key) => client.getProjectTypes(key),
    getProjectMembers: (key) => client.getProjectMembers(key),
    getProjectLabels: (key) => client.getProjectLabels(key),
    getIssueDetail: (issueKey) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.getIssueDetail(projectKey, number);
    },
    createIssue: (projectKey, body) =>
      client.createIssue(projectKey, body as Parameters<PatApiClient['createIssue']>[1]),
    updateIssueContent: (issueKey, body) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.updateIssue(projectKey, number, body);
    },
    setIssueType: (issueKey, typeId) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.setIssueType(projectKey, number, typeId);
    },
    setIssueParent: (issueKey, parentNumber) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.setIssueParent(projectKey, number, parentNumber);
    },
    replaceIssueAssignees: (issueKey, ids) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.replaceIssueAssignees(projectKey, number, ids);
    },
    replaceIssueLabels: (issueKey, ids) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.replaceIssueLabels(projectKey, number, ids);
    },
    addComment: async (issueKey, body) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      const detail = await client.getIssueDetail(projectKey, number);
      await client.addIssueComment(detail.summary.id, body);
    },
    editComment: async (issueKey, commentId, body) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      const detail = await client.getIssueDetail(projectKey, number);
      await client.editIssueComment(detail.summary.id, commentId, body);
    },
    addIssueDependency: (issueKey, otherNumber, direction) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.addIssueDependency(projectKey, number, otherNumber, direction);
    },
    removeIssueDependency: (issueKey, otherNumber, direction) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.removeIssueDependency(projectKey, number, otherNumber, direction);
    },
  };
}

/** 이슈 도메인 도구 10종을 구성한다(공유 7 + PAT 전용 list_projects/get_project/list_issues). */
export function buildIssueTools(client: PatApiClient): McpTool[] {
  const listProjectsInput = z.object({});
  const getProjectInput = z.object({ projectKey: z.string().min(1) });
  // #841: 서버(/me/issues)가 projectKey 한정과 라벨·유형 이름·username 해석을 직접 지원하므로 그대로 전달한다.
  // 모르는 값은 서버가 400 + 사용 가능 목록으로 거부해 LLM 이 자가교정할 수 있다.
  const listMyIssuesInput = z.object({
    projectKey: z.string().optional().describe('특정 프로젝트로 한정(예: "WP"). 생략 시 내가 속한 모든 프로젝트'),
    status: z.string().optional().describe('상태 CSV: TODO,IN_PROGRESS,DONE,CANCELED'),
    priority: z.array(z.enum(['LOW', 'MID', 'HIGH'])).optional(),
    label: z.string().optional().describe('라벨 이름 CSV. 여러 개면 모두 붙은 이슈만(AND)'),
    type: z.string().optional().describe('유형 이름 CSV(예: "BUG,STORY"). 하나라도 일치(OR)'),
    assignee: z
      .string()
      .optional()
      .describe('담당자 CSV: "me" | "null"(담당 없음) | username. assignee·reporter 모두 생략 시 "me"'),
    reporter: z.string().optional().describe('작성자 CSV: "me" | username'),
    dueFrom: z.string().optional().describe('마감일 하한 yyyy-MM-dd'),
    dueTo: z.string().optional().describe('마감일 상한 yyyy-MM-dd'),
    q: z.string().optional(),
    size: z.number().int().min(1).max(100).optional(),
  });

  return [
    {
      name: 'list_projects',
      description: '접근 가능한 프로젝트 목록을 JSON 으로 반환합니다.',
      inputSchema: listProjectsInput,
      async handler() {
        return JSON.stringify(await client.listProjects());
      },
    },
    {
      name: 'get_project',
      description:
        '프로젝트 단건 정보(키·이름·설명·유형)와 함께 이슈 생성/수정에 쓰는 ' +
        'types(유형)·labels(라벨)·members(멤버 username)를 동봉해 반환합니다. ' +
        'create_issue/update_issue 의 type·labels·assignees 값은 여기 이름/username 을 사용하세요.',
      inputSchema: getProjectInput,
      async handler(args) {
        const { projectKey } = getProjectInput.parse(args);
        const [project, types, labels, members] = await Promise.all([
          client.getProject(projectKey),
          client.getProjectTypes(projectKey),
          client.getProjectLabels(projectKey),
          client.getProjectMembers(projectKey),
        ]);
        return JSON.stringify({ ...(project as Record<string, unknown>), types, labels, members });
      },
    },
    {
      name: 'list_issues',
      description:
        '이슈 목록을 조회합니다. 기본은 내(토큰 소유자) 담당 이슈이며 projectKey·status·priority·label·type·' +
        'assignee·reporter·dueFrom/dueTo·q 로 좁힙니다. 사람은 username, 라벨·유형은 이름으로 지정하세요 ' +
        '(get_project 가 목록 제공). 없는 값이면 사용 가능 목록을 담은 오류가 반환됩니다.',
      inputSchema: listMyIssuesInput,
      async handler(args) {
        const { priority, ...p } = listMyIssuesInput.parse(args);
        const assignee = defaultListAssignee(p);
        const items = await client.listMyIssues({
          ...p,
          ...(assignee ? { assignee } : {}),
          ...(priority?.length ? { priority: priority.join(',') } : {}),
          size: p.size ?? 30,
        });
        return JSON.stringify(items);
      },
    },
    ...buildSharedIssueTools(buildIssueToolClient(client)),
  ];
}
