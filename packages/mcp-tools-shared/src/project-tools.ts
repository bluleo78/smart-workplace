// src/project-tools.ts — 프로젝트 조회 2종 + 이슈 목록 조회. 두 앱 공유(#846).
// 프로젝트 쓰기(생성·삭제·멤버 추가)는 확인 카드가 있는 ai-agent 의 propose_* 에만 있다.
import { z } from 'zod';
import type { McpTool } from './mcp-tool.js';
import { defaultListAssignee } from './resolve.js';
import { formatIssueKey } from './parse.js';
import { listIssuesInput } from './schemas.js';
import type { IssueListQuery, IssueRow, ProjectToolClient } from './tool-client.js';

export const listProjectsInput = z.object({
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(100).default(50),
});
export const projectKeyInput = z.object({ projectKey: z.string().min(1) });

/** GET /me/issues 이슈 행 → LLM 뷰. 사람은 username 으로만 노출한다(#833 — 숫자 id 를 쓰기 도구로 흘려보내지 않게). */
export function toIssueListItem(it: IssueRow) {
  const { projectKey, number } = it;
  return {
    issueKey: it.issueKey ?? (formatIssueKey(projectKey, number) ?? String(it.id ?? '')),
    title: it.title ?? '',
    status: it.status ?? '',
    priority: it.priority ?? '',
    assignees: (it.assignees ?? []).map((a) => ({
      username: a.username ?? null,
      name: a.name ?? a.username ?? '',
      kind: a.kind ?? 'HUMAN',
    })),
    dueDate: it.dueDate ?? null,
    type: it.type ?? null,
    blocked: Boolean(it.blocked),
  };
}

/** 프로젝트 멤버 → LLM 뷰. 숫자 userId 는 빼고 사람을 가리키는 username 만 준다(#833). get_project·list_project_members 공용. */
export function toProjectMemberView({ username, name, role }: { username: string; name?: string; role?: string }) {
  return { username, name, role };
}

/** 프로젝트·이슈 목록 조회 도구 3종(list_projects/get_project/list_issues). */
export function buildProjectTools(client: ProjectToolClient): McpTool[] {
  return [
    {
      name: 'list_projects',
      description: '접근 가능한 프로젝트 목록을 JSON 으로 반환합니다. page/size 로 페이지네이션합니다(기본 0/50).',
      inputSchema: listProjectsInput,
      async handler(args) {
        const { page, size } = listProjectsInput.parse(args);
        return JSON.stringify(await client.listProjects(page, size));
      },
    },
    {
      name: 'get_project',
      description:
        '프로젝트 상세(key·name·description·type)와 이 프로젝트에서 쓸 수 있는 이슈 유형(issueTypes)·라벨(labels) 이름, 멤버(members: username·name·role)를 JSON 으로 반환합니다. ' +
        'create_issue/update_issue 의 type·labels 는 이 목록의 이름만, assignees 는 members 의 username 만 사용하세요.',
      inputSchema: projectKeyInput,
      async handler(args) {
        const { projectKey } = projectKeyInput.parse(args);
        // #844: 이슈 쓰기 도구의 type·labels·assignees 값을 조회로 조달하게 한다(추측 방지). 넷은 독립 조회라 병렬.
        const [project, types, labels, members] = await Promise.all([
          client.getProject(projectKey),
          client.getProjectTypes(projectKey),
          client.getProjectLabels(projectKey),
          client.getProjectMembers(projectKey),
        ]);
        return JSON.stringify({
          ...(project as Record<string, unknown>),
          issueTypes: types.map((t) => t.name),
          labels: labels.map((l) => l.name),
          members: members.map(toProjectMemberView),
        });
      },
    },
    {
      name: 'list_issues',
      description:
        '이슈 목록을 JSON 배열로 반환합니다. assignee·reporter 둘 다 생략 시 내 담당("me"), projectKey·status·priority·label·type·q·dueFrom/dueTo·blocked·topLevel 로 좁힙니다. ' +
        '사람은 username, 라벨·유형은 이름으로 지정하고(get_project 가 목록 제공), 없는 값이면 사용 가능 목록을 담은 오류가 옵니다. ' +
        '각 항목은 issueKey·title·status·priority·assignees·dueDate 를 포함하며, 상세는 issueKey 로 get_issue_detail 을 호출하세요.',
      inputSchema: listIssuesInput,
      async handler(args) {
        const { priority, size, ...p } = listIssuesInput.parse(args);
        const assignee = defaultListAssignee(p);
        // undefined 필드는 쿼리에서 뺀다 — 서버는 빈 값과 미지정을 다르게 볼 수 있다.
        const query: IssueListQuery = Object.fromEntries(
          Object.entries({ ...p, assignee }).filter((e): e is [string, string | boolean] => e[1] !== undefined),
        );
        if (priority?.length) query.priority = priority.join(',');
        query.size = size ?? 30;
        const items = await client.listIssues(query);
        return JSON.stringify(items.map(toIssueListItem));
      },
    },
  ];
}
