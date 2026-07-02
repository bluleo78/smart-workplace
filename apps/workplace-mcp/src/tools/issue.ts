// src/tools/issue.ts — 이슈 도메인 도구. 사용자 본인 권한으로 직접 실행된다
// (에이전트의 propose_* 승인 카드 패턴과 달리 확인 단계 없음 — 클라이언트측 승인은 MCP 호스트 몫).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 'WP-12' → { projectKey: 'WP', number: 12 } (마지막 '-' 기준 분리 — ai-agent parseIssueKey 미러).
 * 형식이 맞지 않으면(하이픈 없음 등) 명확한 에러를 던진다(도구 레이어가 isError 로 래핑). */
export function parseIssueKey(issueKey: string): { projectKey: string; number: number } {
  const m = /^(.+)-(\d+)$/.exec(issueKey);
  if (!m) {
    throw new Error(`issueKey 형식이 올바르지 않습니다: ${issueKey}`);
  }
  return { projectKey: m[1], number: Number(m[2]) };
}

const issueKeyInput = z.object({ issueKey: z.string().min(1) });

/** 이슈 도메인 도구 7종(list_projects/get_project/list_issues/get_issue_detail/create_issue/add_comment/update_status) 을 구성한다. */
export function buildIssueTools(client: PatApiClient): McpTool[] {
  const listProjectsInput = z.object({});
  const getProjectInput = z.object({ projectKey: z.string().min(1) });
  const listMyIssuesInput = z.object({
    projectKey: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
    size: z.number().int().min(1).max(100).optional(),
  });
  const createIssueInput = z.object({
    projectKey: z.string().min(1),
    title: z.string().min(1).max(200),
    body: z.string().max(10000).optional(),
    priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  });
  const addCommentInput = z.object({ issueKey: z.string().min(1), body: z.string().min(1) });
  const updateStatusInput = z.object({
    issueKey: z.string().min(1),
    status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']),
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
      description: '프로젝트 단건 정보(키·이름·설명·유형)를 JSON 으로 반환합니다.',
      inputSchema: getProjectInput,
      async handler(args) {
        const { projectKey } = getProjectInput.parse(args);
        return JSON.stringify(await client.getProject(projectKey));
      },
    },
    {
      name: 'list_issues',
      description:
        '내(토큰 소유자)게 할당된 이슈 목록을 조회합니다. status/q(검색어)로 필터링할 수 있습니다. ' +
        'projectKey 는 서버가 지원하지 않아 클라이언트에서 issueKey 접두어로 후처리 필터링합니다. ' +
        '후처리 특성상 조회된 size 범위 안에서만 걸러지므로, 결과가 비면 size 를 늘려 재시도하세요.',
      inputSchema: listMyIssuesInput,
      async handler(args) {
        const { projectKey, ...p } = listMyIssuesInput.parse(args);
        const items = (await client.listMyIssues({
          ...p,
          assignee: 'me',
          size: p.size ?? 30,
        })) as Array<{ issueKey?: string }>;
        const filtered = projectKey
          ? items.filter((item) => {
              if (!item.issueKey) return false;
              const idx = item.issueKey.lastIndexOf('-');
              return idx > 0 && item.issueKey.slice(0, idx) === projectKey;
            })
          : items;
        return JSON.stringify(filtered);
      },
    },
    {
      name: 'get_issue_detail',
      description:
        '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다. issueKey 예: WP-12',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);
        return JSON.stringify(await client.getIssueDetail(projectKey, number));
      },
    },
    {
      name: 'create_issue',
      description: '프로젝트에 새 이슈를 등록합니다. 작성자는 토큰 소유자 본인입니다.',
      inputSchema: createIssueInput,
      async handler(args) {
        const { projectKey, ...body } = createIssueInput.parse(args);
        return JSON.stringify(await client.createIssue(projectKey, body));
      },
    },
    {
      name: 'add_comment',
      description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey, body } = addCommentInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);
        const detail = await client.getIssueDetail(projectKey, number);
        await client.addIssueComment(detail.summary.id, body);
        return 'ok';
      },
    },
    {
      name: 'update_status',
      description: '이슈 상태를 변경합니다. 허용값: TODO / IN_PROGRESS / DONE / CANCELED.',
      inputSchema: updateStatusInput,
      async handler(args) {
        const { issueKey, status } = updateStatusInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);
        await client.updateIssueStatus(projectKey, number, status);
        return 'ok';
      },
    },
  ];
}
