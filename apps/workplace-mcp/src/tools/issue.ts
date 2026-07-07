// src/tools/issue.ts — 이슈 도메인 도구. 사용자 본인 권한으로 직접 실행된다
// (에이전트의 propose_* 승인 카드 패턴과 달리 확인 단계 없음 — 클라이언트측 승인은 MCP 호스트 몫).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import { resolveAssigneeIds, resolveLabelIds, resolveTypeId } from './resolve.js';
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

/** 이슈 도메인 도구 8종(list_projects/get_project/list_issues/get_issue_detail/create_issue/update_issue/add_comment/edit_comment) 을 구성한다. */
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
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    type: z.string().optional(), // 유형 이름(예: BUG) — typeId 로 리졸브
    assignees: z.array(z.string()).optional(), // username 배열 — assigneeIds 로 리졸브
    parent: z.number().int().positive().optional(), // 부모 이슈 번호(SUBTASK 생성 시)
  });
  const addCommentInput = z.object({ issueKey: z.string().min(1), body: z.string().min(1) });
  const editCommentInput = z.object({
    issueKey: z.string().min(1),
    commentId: z.number().int().positive(),
    body: z.string().min(1),
  });
  const updateIssueInput = z.object({
    issueKey: z.string().min(1),
    title: z.string().max(200).optional(),
    body: z.string().max(10000).optional(),
    priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
    status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    clearDueDate: z.boolean().optional(),
    clearStartDate: z.boolean().optional(),
    type: z.string().optional(), // 유형 이름 → typeId
    parent: z.number().int().positive().nullable().optional(), // 번호=설정, null=해제, 생략=변경없음
    assignees: z.array(z.string()).optional(), // username[] → 집합 교체
    labels: z.array(z.string()).optional(), // 라벨명[] → 집합 교체
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
        // 리졸브 소스를 한 번에 병합 — 클라이언트가 이름→ID 매핑을 스스로 할 수 있게 한다.
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
      description:
        '프로젝트에 새 이슈를 등록합니다. 작성자는 토큰 소유자 본인입니다. ' +
        'type 은 유형 이름(예: BUG), assignees 는 username 배열, parent 는 부모 이슈 번호입니다. ' +
        '유효한 값은 get_project 응답의 types/members 를 참고하세요.',
      inputSchema: createIssueInput,
      async handler(args) {
        const { projectKey, type, assignees, parent, ...rest } = createIssueInput.parse(args);
        // 리졸브(이름→ID)를 create 이전에 수행 — 실패 시 이슈를 만들지 않고 에러를 던진다.
        const body: {
          title: string;
          body?: string;
          priority?: string;
          dueDate?: string;
          startDate?: string;
          assigneeIds?: number[];
          typeId?: number;
          parentNumber?: number;
        } = { ...rest };
        if (type) body.typeId = await resolveTypeId(client, projectKey, type);
        if (assignees) body.assigneeIds = await resolveAssigneeIds(client, projectKey, assignees);
        if (parent != null) body.parentNumber = parent;
        return JSON.stringify(await client.createIssue(projectKey, body));
      },
    },
    {
      name: 'update_issue',
      description:
        '이슈를 부분 수정합니다. 전달한 필드만 변경됩니다. status/priority 는 enum, ' +
        'type 은 유형 이름, assignees 는 username 배열(집합 교체), labels 는 라벨명 배열(집합 교체), ' +
        'parent 는 부모 이슈 번호(null 전달 시 부모 해제)입니다. clearDueDate/clearStartDate 로 날짜를 비웁니다. ' +
        '각 항목은 독립 저장되며 결과를 { ok, results } 로 보고합니다(부분 실패 가능).',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, type, parent, assignees, labels, ...rest } =
          updateIssueInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);

        // 1) 리졸브(이름→ID)를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        const typeId = type ? await resolveTypeId(client, projectKey, type) : undefined;
        const assigneeIds = assignees
          ? await resolveAssigneeIds(client, projectKey, assignees)
          : undefined;
        const labelIds = labels ? await resolveLabelIds(client, projectKey, labels) : undefined;

        // 2) 필드별로 해당 엔드포인트에 팬아웃. 각 단계 독립 저장 — 성공/실패를 구조화해 모은다.
        const results: Record<string, string> = {};
        const run = async (key: string, fn: () => Promise<unknown>) => {
          try {
            await fn();
            results[key] = 'ok';
          } catch (e) {
            results[key] = `failed: ${errText(e)}`;
          }
        };

        // 내용/상태/우선순위/날짜 → PATCH /{number}
        const content: Record<string, unknown> = { ...rest };
        if (Object.keys(content).length > 0) {
          await run('content', () => client.updateIssue(projectKey, number, content));
        }
        if (typeId !== undefined)
          await run('type', () => client.setIssueType(projectKey, number, typeId));
        if (parent !== undefined) {
          await run('parent', () => client.setIssueParent(projectKey, number, parent));
        }
        if (assigneeIds !== undefined) {
          await run('assignees', () =>
            client.replaceIssueAssignees(projectKey, number, assigneeIds),
          );
        }
        if (labelIds !== undefined) {
          await run('labels', () => client.replaceIssueLabels(projectKey, number, labelIds));
        }

        const ok = Object.values(results).every((v) => v === 'ok');
        return JSON.stringify({ ok, results });
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
      name: 'edit_comment',
      description:
        '이슈의 기존 코멘트를 수정합니다. commentId 는 get_issue_detail 의 comments 에서 확인하세요.',
      inputSchema: editCommentInput,
      async handler(args) {
        const { issueKey, commentId, body } = editCommentInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);
        const detail = await client.getIssueDetail(projectKey, number);
        await client.editIssueComment(detail.summary.id, commentId, body);
        return 'ok';
      },
    },
  ];
}

/** 팬아웃 단계 실패 메시지를 짧게 뽑는다 — axios 응답 본문 우선, 없으면 message. */
function errText(e: unknown): string {
  const anyE = e as { response?: { data?: unknown }; message?: string };
  if (anyE?.response?.data !== undefined) {
    return typeof anyE.response.data === 'string'
      ? anyE.response.data
      : JSON.stringify(anyE.response.data);
  }
  return anyE?.message ?? String(e);
}
