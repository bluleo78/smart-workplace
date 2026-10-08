// src/issue-tools.ts — 두 앱 공유 이슈 도구 9종. 핸들러는 IssueToolClient(issueKey 기준)만 호출.
import { errText, parseIssueKey } from './parse.js';
import type { SharedTool } from './mcp-tool.js';
import { ISSUE_DETAIL_HISTORY_LIMIT, normalizeIssueDetail } from './issue-detail.js';
import { resolveAssigneeIds, resolveCycleIds, resolveLabelIds, resolveMilestoneId, resolveTypeId } from './resolve.js';
import {
  addCommentInput,
  createIssueInput,
  dependencyInput,
  editCommentInput,
  issueKeyInput,
  updateIssueInput,
} from './schemas.js';
import type { IssueToolClient } from './tool-client.js';

/** 공유 이슈 도구 9종 구성. 각 앱은 자기 클라이언트를 IssueToolClient 로 어댑팅해 넘긴다. */
export function buildSharedIssueTools(client: IssueToolClient): SharedTool[] {
  return [
    {
      name: 'get_issue_detail',
      kind: 'read',
      description:
        '이슈 전체 컨텍스트를 JSON 으로 반환합니다. issueKey 예: WP-12. ' +
        '본문·상태·우선순위·유형·담당자·작성자(reporter), 날짜(dueDate·startDate, createdAt·updatedAt·closedAt — 시각은 +09:00), ' +
        '라벨·마일스톤·사이클(cycles: name·status)·부모(parent)·하위 진행률(children), 의존성(blockedBy·blocks), 커스텀 필드, 첨부, ' +
        `코멘트, 최근 변경 이력(history, 최대 ${ISSUE_DETAIL_HISTORY_LIMIT}건 — 상태가 언제 바뀌었는지 등)을 포함합니다. ` +
        'closedAt 은 완료(DONE)·취소(CANCELED) 모두에 기록되므로 둘의 구분은 status 로 하세요. 사람(담당자·작성자·코멘트/이력 작성자·첨부자)은 username(쓰기 도구용 — 모르면 null)과 name(표시 이름)으로 옵니다.',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        // WP-176: update_issue 의 cycles 는 집합 교체라, 기존 사이클을 알아야 추가·제거 시 다른 사이클을 지우지 않는다 — 함께 동봉.
        // WP-307: 멤버(코멘트 작성자 username)·마일스톤(id→이름)은 보조 정보라 실패해도 상세는 돌려준다.
        const [raw, cycles, members, milestones] = await Promise.all([
          client.getIssueDetail(issueKey),
          client.getIssueCycles(issueKey),
          client.getProjectMembers(projectKey).catch(() => []),
          client.getProjectMilestones(projectKey).catch(() => []),
        ]);
        const detail = normalizeIssueDetail(raw, {
          usernameById: new Map(members.map((m) => [m.userId, m.username])),
          milestoneNameById: new Map(milestones.map((m) => [m.id, m.name])),
        });
        return JSON.stringify({ ...detail, cycles: cycles.map(({ name, status }) => ({ name, status })) });
      },
    },
    {
      name: 'create_issue',
      kind: 'write',
      description:
        '프로젝트에 새 이슈를 등록합니다. type 은 유형 이름(예: BUG), assignees 는 username 배열("me"=나, 호출자 본인), ' +
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
      kind: 'write',
      description:
        '이슈를 부분 수정합니다. 전달한 필드만 변경됩니다. status/priority 는 enum, type 은 유형 이름, ' +
        'assignees 는 username 배열("me"=나, 집합 교체), labels 는 라벨명 배열(집합 교체), parent 는 부모 이슈 번호(null=해제)입니다. ' +
        'milestone 은 마일스톤 이름(null=해제), cycles 는 사이클 이름 배열(집합 교체, []=전부 해제)입니다. ' +
        'clearDueDate/clearStartDate 로 날짜를 비웁니다. 각 항목은 독립 저장되며 결과를 { ok, results } 로 보고합니다.',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, type, parent, assignees, labels, milestone, cycles, ...rest } = updateIssueInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);

        // 1) 리졸브를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        //    서로 독립 조회라 병렬로 보낸다.
        const [typeId, assigneeIds, labelIds, milestoneId, cycleIds] = await Promise.all([
          type ? resolveTypeId(client, projectKey, type) : undefined,
          assignees ? resolveAssigneeIds(client, projectKey, assignees) : undefined,
          labels ? resolveLabelIds(client, projectKey, labels) : undefined,
          milestone ? resolveMilestoneId(client, projectKey, milestone) : undefined,
          cycles ? resolveCycleIds(client, projectKey, cycles) : undefined,
        ]);

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

        // 마일스톤은 이슈 PATCH 본문의 필드다(milestoneId 설정 / clearMilestone 해제).
        const content: Record<string, unknown> = { ...rest };
        if (milestoneId !== undefined) content.milestoneId = milestoneId;
        if (milestone === null) content.clearMilestone = true;
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
        if (cycleIds !== undefined) await run('cycles', () => client.replaceIssueCycles(issueKey, cycleIds));

        const ok = Object.values(results).every((v) => v === 'ok');
        return JSON.stringify({ ok, results });
      },
    },
    {
      name: 'add_comment',
      kind: 'write',
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
      kind: 'write',
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
      kind: 'write',
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
      kind: 'write',
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
    {
      name: 'watch_issue',
      kind: 'write',
      description:
        '이슈를 워치해 이후 변경 알림을 받습니다. 이미 워치 중이면 아무것도 바뀌지 않습니다. 프로젝트 멤버만 할 수 있습니다.',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        await client.watchIssue(issueKey);
        return 'ok';
      },
    },
    {
      name: 'unwatch_issue',
      kind: 'write',
      description: '이슈 워치를 해제해 변경 알림을 그만 받습니다. 워치 중이 아니어도 에러 없이 성공합니다.',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        await client.unwatchIssue(issueKey);
        return 'ok';
      },
    },
  ];
}
