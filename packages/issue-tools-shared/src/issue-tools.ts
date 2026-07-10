// src/issue-tools.ts — 두 앱 공유 이슈 도구 7종. 핸들러는 IssueToolClient(issueKey 기준)만 호출.
import { errText, parseIssueKey } from './parse.js';
import type { McpTool } from './mcp-tool.js';
import { normalizeIssueDetail } from './issue-detail.js';
import { resolveAssigneeIds, resolveLabelIds, resolveTypeId } from './resolve.js';
import {
  addCommentInput,
  createIssueInput,
  dependencyInput,
  editCommentInput,
  issueKeyInput,
  updateIssueInput,
} from './schemas.js';
import type { IssueToolClient } from './issue-client.js';

/** 공유 이슈 도구 7종 구성. 각 앱은 자기 클라이언트를 IssueToolClient 로 어댑팅해 넘긴다. */
export function buildSharedIssueTools(client: IssueToolClient): McpTool[] {
  return [
    {
      name: 'get_issue_detail',
      description:
        '이슈의 본문·상태·담당자·코멘트·의존성 등 전체 컨텍스트를 JSON 으로 반환합니다. issueKey 예: WP-12',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        return JSON.stringify(normalizeIssueDetail(await client.getIssueDetail(issueKey)));
      },
    },
    {
      name: 'create_issue',
      description:
        '프로젝트에 새 이슈를 등록합니다. type 은 유형 이름(예: BUG), assignees 는 username 배열, ' +
        'parent 는 부모 이슈 번호입니다. type/assignees 이름이 유효하지 않으면 오류에 사용 가능한 값 목록이 포함됩니다.',
      inputSchema: createIssueInput,
      async handler(args) {
        const { projectKey, type, assignees, parent, ...rest } = createIssueInput.parse(args);
        // 리졸브(이름→ID)를 create 이전에 수행 — 실패 시 이슈를 만들지 않고 throw.
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
        '이슈를 부분 수정합니다. 전달한 필드만 변경됩니다. status/priority 는 enum, type 은 유형 이름, ' +
        'assignees 는 username 배열(집합 교체), labels 는 라벨명 배열(집합 교체), parent 는 부모 이슈 번호(null=해제)입니다. ' +
        'clearDueDate/clearStartDate 로 날짜를 비웁니다. 각 항목은 독립 저장되며 결과를 { ok, results } 로 보고합니다.',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, type, parent, assignees, labels, ...rest } = updateIssueInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);

        // 1) 리졸브를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        const typeId = type ? await resolveTypeId(client, projectKey, type) : undefined;
        const assigneeIds = assignees
          ? await resolveAssigneeIds(client, projectKey, assignees)
          : undefined;
        const labelIds = labels ? await resolveLabelIds(client, projectKey, labels) : undefined;

        // 2) 필드별 팬아웃 — 각 단계 독립 저장, 성공/실패 구조화.
        const results: Record<string, string> = {};
        const run = async (key: string, fn: () => Promise<unknown>) => {
          try {
            await fn();
            results[key] = 'ok';
          } catch (e) {
            results[key] = `failed: ${errText(e)}`;
          }
        };

        const content: Record<string, unknown> = { ...rest };
        if (Object.keys(content).length > 0) {
          await run('content', () => client.updateIssueContent(issueKey, content));
        }
        if (typeId !== undefined) await run('type', () => client.setIssueType(issueKey, typeId));
        if (parent !== undefined) await run('parent', () => client.setIssueParent(issueKey, parent));
        if (assigneeIds !== undefined) {
          await run('assignees', () => client.replaceIssueAssignees(issueKey, assigneeIds));
        }
        if (labelIds !== undefined) {
          await run('labels', () => client.replaceIssueLabels(issueKey, labelIds));
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
        await client.addComment(issueKey, body);
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
        await client.editComment(issueKey, commentId, body);
        return 'ok';
      },
    },
    {
      name: 'add_issue_dependency',
      description:
        '이슈 간 의존성(차단 관계)을 추가합니다. direction="blocks" 면 issueKey 이슈가 ' +
        'otherIssueKey 이슈를 차단하고, "blockedBy" 면 반대로 otherIssueKey 에 의해 차단됩니다. ' +
        '두 이슈는 같은 프로젝트여야 합니다. 순환 관계가 되면 에러가 발생합니다.',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        return JSON.stringify(await client.addIssueDependency(issueKey, otherNumber, direction));
      },
    },
    {
      name: 'remove_issue_dependency',
      description: '이슈 간 의존성을 제거합니다. 존재하지 않아도 에러 없이 성공합니다(멱등).',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        await client.removeIssueDependency(issueKey, otherNumber, direction);
        return 'ok';
      },
    },
  ];
}
