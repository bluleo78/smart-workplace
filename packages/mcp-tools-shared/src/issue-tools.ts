// src/issue-tools.ts — 두 앱 공유 이슈 도구 11종. 핸들러는 IssueToolClient(issueKey 기준)만 호출.
import { dropEmpty } from './compact.js';
import { errText, parseIssueKey } from './parse.js';
import type { SharedTool } from './mcp-tool.js';
import { ISSUE_DETAIL_COMMENT_HARD_LIMIT, ISSUE_DETAIL_COMMENT_LIMIT, ISSUE_DETAIL_HISTORY_LIMIT, normalizeIssueDetail } from './issue-detail.js';
import { toAgentWorkView } from './agent-work-view.js';
import { toAuthorView, toSeoulIso } from './issue-view.js';
import { toIssueListItem } from './project-tools.js';
import {
  fieldDefByName,
  resolveAssigneeIds,
  resolveCycleIds,
  resolveLabelIds,
  resolveMilestoneId,
  resolveTypeId,
  toFieldValue,
} from './resolve.js';
import {
  addCommentInput,
  createIssueInput,
  dependencyInput,
  editCommentInput,
  getIssueChatInput,
  getIssueDetailInput,
  issueKeyInput,
  reportAgentWorkInput,
  updateIssueInput,
} from './schemas.js';
import { resolveMentionTokens } from './messaging-tools.js';
import type { IssueRow, IssueToolClient } from './tool-client.js';

/** 첨부 텍스트 추출 상태 → {status, totalChars?, reason?} — truncated·reasonCode 같은 내부 값은 AI 에 필요 없어 뺀다. */
function toExtractionView(extraction: unknown) {
  if (!extraction || typeof extraction !== 'object') return undefined;
  const e = extraction as Record<string, unknown>;
  return dropEmpty({ status: e.status, totalChars: e.totalChars, reason: e.reason });
}

/** 이슈 챗 메시지 → LLM 뷰(WP-373). 숫자 사용자 id(#833)·멘션·드라이브 링크 원형은 빼고, 첨부는 read_file(issue_chat) 입력 이름으로 바꾼다. */
function toIssueChatMessageView(m: Record<string, unknown>) {
  const deleted = m.deleted === true;
  const attachments = Array.isArray(m.attachments) ? (m.attachments as Record<string, unknown>[]) : [];
  return dropEmpty({
    id: m.id,
    author: toAuthorView(m.authorUsername, m.authorName, m.authorKind),
    // 삭제된 글은 서버가 본문 자리에 "(삭제됨)" 을 채우므로 body 를 빼고 deleted 만 알린다.
    // 본문의 멘션 토큰 <@id> 은 mentions 로 이름을 풀어 숫자 사용자 id 가 AI 에 닿지 않게 한다(#833).
    body: deleted ? undefined : resolveMentionTokens(String(m.body ?? ''), m.mentions),
    question: m.question === true ? true : undefined,
    // 시각은 목록·상세와 같은 Asia/Seoul 오프셋 표기로 맞춘다.
    createdAt: toSeoulIso(m.createdAt),
    editedAt: toSeoulIso(m.editedAt) ?? undefined,
    deleted: deleted ? true : undefined,
    attachments: attachments.map((a) =>
      dropEmpty({ attachmentId: a.fileId, name: a.originalName, mimeType: a.mimeType, size: a.sizeBytes, extraction: toExtractionView(a.extraction) }),
    ),
  });
}

/**
 * 부모 이슈 키(WP-12) → 서버용 이슈 번호. 서버는 부모를 같은 프로젝트의 번호(parentNumber)로만 받는다 —
 * 다른 프로젝트 키가 오면 번호만 떼어 쓰면 엉뚱한 이슈가 부모가 되므로 호출 전에 막는다(WP-353).
 * 키를 이슈 도구의 다른 입력(issueKey·otherIssueKey)과 같은 표기로 받아 "parent 만 번호"인 불일치를 없앤 것이다.
 */
function parentNumberOf(parentKey: string, projectKey: string): number {
  const { projectKey: parentProject, number } = parseIssueKey(parentKey);
  if (parentProject !== projectKey) {
    throw new Error(`부모 이슈는 같은 프로젝트(${projectKey})의 이슈여야 합니다: ${parentKey}`);
  }
  return number;
}

/**
 * 이슈 드라이브 링크(DriveLinkResponse) → LLM 뷰(WP-356). 파일을 다시 가리키는 driveFileId·이름·스페이스만 남긴다 — 링크를 건 사람의 숫자
 * createdById(#833)와 core fileId(이슈 첨부 attachmentId 와 헷갈린다)는 뺀다. 휴지통·삭제 상태일 때만 availability 를 싣는다.
 */
function toDriveLinkView(link: Record<string, unknown>) {
  return dropEmpty({
    driveFileId: link.driveFileId,
    name: link.name,
    spaceName: link.spaceName,
    availability: link.availability === 'ACTIVE' ? undefined : link.availability,
  });
}

/** 공유 이슈 도구 10종 구성. 각 앱은 자기 클라이언트를 IssueToolClient 로 어댑팅해 넘긴다. */
export function buildSharedIssueTools(client: IssueToolClient): SharedTool[] {
  return [
    {
      name: 'get_issue_detail',
      app: 'issue',
      kind: 'read',
      description:
        'Returns one issue (이슈) by issueKey (e.g. WP-12): Markdown body, all fields (dates +09:00), cycles, parent, children, blockedBy/blocks, ' +
        `custom fields, watchers, driveLinks, attachments (attachmentId for read_file), the latest ${ISSUE_DETAIL_COMMENT_LIMIT} comments and ` +
        `${ISSUE_DETAIL_HISTORY_LIMIT} history entries. commentsOmitted/historyOmitted count older ones left out (absent = complete); ` +
        `allComments:true returns up to ${ISSUE_DETAIL_COMMENT_HARD_LIMIT} comments. closedAt: DONE or CANCELED time. People ` +
        '{username, name, kind}, watchers lack kind; username null if unknown.',
      inputSchema: getIssueDetailInput,
      async handler(args) {
        const { issueKey, allComments } = getIssueDetailInput.parse(args);
        // WP-176: update_issue 의 cycles 는 집합 교체라, 기존 사이클을 알아야 추가·제거 시 다른 사이클을 지우지 않는다 — 함께 동봉.
        // WP-356: 워처·드라이브 링크도 상세 화면에 있는 정보라 함께 싣는다(모두 독립 조회라 병렬).
        const [raw, cycles, watchers, driveLinks] = await Promise.all([
          client.getIssueDetail(issueKey),
          client.getIssueCycles(issueKey),
          client.getIssueWatchers(issueKey),
          client.getIssueDriveLinks(issueKey),
        ]);
        const detail = normalizeIssueDetail(raw, { allComments });
        return JSON.stringify({
          ...detail,
          cycles: cycles.map(({ name, status }) => ({ name, status })),
          // 숫자 userId 는 빼고 사람을 username 으로만 가리킨다(#833).
          watchers: watchers.map(({ username, name }) => ({ username, name })),
          ...(driveLinks.length > 0 && { driveLinks: driveLinks.map(toDriveLinkView) }),
        });
      },
    },
    {
      name: 'create_issue',
      app: 'issue',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Creates an issue (이슈) in projectKey and returns it. type, labels, milestone, cycles and assignees (usernames, "me" = caller) are names ' +
        'from get_project; unknown names fail before creating, listing allowed values. New assignees are notified; an assigned AI agent ' +
        'starts working.',
      inputSchema: createIssueInput,
      async handler(args) {
        const { projectKey, type, assignees, parent, labels, milestone, cycles, ...rest } = createIssueInput.parse(args);
        // 리졸브(이름→ID)를 create 이전에 수행 — 실패 시 이슈를 만들지 않고 throw. 서로 독립 조회라 병렬로 보낸다.
        // WP-356: 라벨·마일스톤·사이클도 서버가 생성과 같은 트랜잭션에서 붙인다 — 생성 후 update_issue 를 따로 부르지 않아도 된다.
        const parentNumber = parent != null ? parentNumberOf(parent, projectKey) : undefined;
        const [typeId, assigneeIds, labelIds, milestoneId, cycleIds] = await Promise.all([
          type ? resolveTypeId(client, projectKey, type) : undefined,
          assignees ? resolveAssigneeIds(client, projectKey, assignees) : undefined,
          labels?.length ? resolveLabelIds(client, projectKey, labels) : undefined,
          milestone ? resolveMilestoneId(client, projectKey, milestone) : undefined,
          cycles?.length ? resolveCycleIds(client, projectKey, cycles) : undefined,
        ]);
        // undefined 는 JSON 직렬화에서 빠진다 — 준 값만 서버로 간다.
        const body = { ...rest, typeId, assigneeIds, parentNumber, labelIds, milestoneId, cycleIds };
        // 서버 응답(IssueResponse)은 reporterId·assignees[].id 같은 숫자 사용자 ID 를 담는다 — 목록 행과 같은 뷰로 바꿔 내보낸다(#833, WP-353).
        return JSON.stringify(dropEmpty(toIssueListItem((await client.createIssue(projectKey, body)) as IssueRow)));
      },
    },
    {
      name: 'update_issue',
      app: 'issue',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Updates an issue (이슈); only given fields change. assignees (usernames, "me" = caller), labels and cycles replace the set ([] clears). ' +
        'Names (type, labels, milestone, cycles, fields) come from get_project; unknown ones fail before any write, then each part saves on ' +
        'its own: {ok, results}. Status/priority changes notify assignees and watchers, new assignees too.',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, type, parent, assignees, labels, milestone, cycles, fields, driveFileId, ...rest } = updateIssueInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);

        // 1) 리졸브를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        //    서로 독립 조회라 병렬로 보낸다. 부모 키 → 번호 변환(같은 프로젝트 검사)도 여기서 한다.
        //    WP-356: 커스텀 필드는 이름 → 정의를 찾고 값 모양·선택지까지 확인한다(서버 검증과 같다, null 은 비우기).
        const parentNumber = parent === undefined || parent === null ? parent : parentNumberOf(parent, projectKey);
        const fieldEntries = fields ? Object.entries(fields) : [];
        const [typeId, assigneeIds, labelIds, milestoneId, cycleIds, fieldValues] = await Promise.all([
          type ? resolveTypeId(client, projectKey, type) : undefined,
          assignees ? resolveAssigneeIds(client, projectKey, assignees) : undefined,
          labels ? resolveLabelIds(client, projectKey, labels) : undefined,
          milestone ? resolveMilestoneId(client, projectKey, milestone) : undefined,
          cycles ? resolveCycleIds(client, projectKey, cycles) : undefined,
          fieldEntries.length
            ? client.getProjectFields(projectKey).then((defs) =>
                fieldEntries.map(([name, value]) => {
                  const def = fieldDefByName(defs, name);
                  return { defId: def.id, value: value === null ? null : toFieldValue(def, value) };
                }),
              )
            : undefined,
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
        if (parentNumber !== undefined) await run('parent', () => client.setIssueParent(issueKey, parentNumber));
        if (assigneeIds !== undefined) {
          await run('assignees', () => client.replaceIssueAssignees(issueKey, assigneeIds));
        }
        if (labelIds !== undefined) {
          await run('labels', () => client.replaceIssueLabels(issueKey, labelIds));
        }
        if (cycleIds !== undefined) await run('cycles', () => client.replaceIssueCycles(issueKey, cycleIds));
        if (fieldValues !== undefined) await run('fields', () => client.updateIssueFields(issueKey, fieldValues));
        if (driveFileId !== undefined) await run('driveLink', () => client.addIssueDriveLink(issueKey, driveFileId));

        const ok = Object.values(results).every((v) => v === 'ok');
        return JSON.stringify({ ok, results });
      },
    },
    {
      name: 'report_agent_work',
      app: 'issue',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Reports work on your assigned issue (이슈) at start/on change: INPUT_REQUIRED before asking the user, AUTH_REQUIRED if you need ' +
        'credentials/permission, REVIEW done awaiting review, BLOCKED + why, PAUSED if told to stop; COMPLETED/FAILED/CANCELED/REJECTED end the ' +
        'work. message posts to issue chat.',
      inputSchema: reportAgentWorkInput,
      async handler(args) {
        const { issueKey, ...body } = reportAgentWorkInput.parse(args);
        const { work, ended } = await client.reportAgentWork(issueKey, body);
        // 서버 뷰의 숫자 id 는 빼고 사람을 username 으로만 가리킨다(#833). 끝났으면 work 는 null 이라 ended 만 남는다.
        return JSON.stringify(dropEmpty({ work: work ? toAgentWorkView(work) : null, ended }));
      },
    },
    {
      name: 'get_issue_chat',
      app: 'issue',
      kind: 'read',
      description:
        'Reads an issue (이슈) chat oldest first. Without after: my latest post, the 5 before it and everything after ' +
        '(all recent if I never posted). Pass next as after for more. question:true = an AI asked and waits. ' +
        'Attachments: read_file source issue_chat.',
      inputSchema: getIssueChatInput,
      async handler(args) {
        const { issueKey, after, limit } = getIssueChatInput.parse(args);
        const threadId = await client.getIssueChatThreadId(issueKey);
        const page = await client.listIssueChatMessages(threadId, { after, limit: limit ?? 30 });
        return JSON.stringify(
          dropEmpty({
            messages: page.items.map(toIssueChatMessageView),
            hasMore: page.hasMore,
            next: page.hasMore && page.nextCursor ? Number(page.nextCursor) : undefined,
            // 이어 읽을 페이지는 없지만 앞쪽이 잘린 부분 목록 — 전부로 오해하지 않게 알린다(내 글이 없을 때 최신 limit 개만 준 경우).
            truncated: page.truncated ? true : undefined,
          }),
        );
      },
    },
    {
      name: 'add_comment',
      app: 'issue',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Adds a Markdown comment to an issue (이슈); the caller starts watching it. Assignees and watchers are notified; an assigned AI agent may ' +
        'reply.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey, body } = addCommentInput.parse(args);
        await client.addComment(issueKey, body);
        return 'ok';
      },
    },
    {
      name: 'update_comment',
      app: 'issue',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        `Replaces an issue comment body (its author or a project OWNER only). commentId: comments[].id from get_issue_detail ` +
        `(latest ${ISSUE_DETAIL_COMMENT_LIMIT}; allComments:true for up to ${ISSUE_DETAIL_COMMENT_HARD_LIMIT}).`,
      inputSchema: editCommentInput,
      async handler(args) {
        const { issueKey, commentId, body } = editCommentInput.parse(args);
        await client.editComment(issueKey, commentId, body);
        return 'ok';
      },
    },
    {
      name: 'add_issue_dependency',
      app: 'issue',
      kind: 'write',
      // 이미 있는 관계를 다시 추가하면 서버가 no-op 으로 처리한다 — 멱등.
      hints: { destructive: false, idempotent: true },
      description:
        'Adds a blocking link between two issues of the same project. direction "blocks": issueKey blocks otherIssueKey; "blockedBy": the ' +
        'reverse. An existing link is a no-op; a cycle is an error. Returns the issue\'s links.',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        // 서버는 갱신된 이슈 상세 전체(코멘트·이력의 숫자 사용자 ID 포함)를 돌려준다 — 이 도구에 필요한 의존성 관계만 정규화해 내보낸다(#833, WP-353).
        const { blockedBy, blocks, blocked } = normalizeIssueDetail(await client.addIssueDependency(issueKey, otherNumber, direction));
        return JSON.stringify({ issueKey, blockedBy, blocks, blocked });
      },
    },
    {
      name: 'remove_issue_dependency',
      app: 'issue',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Removes a blocking link (same arguments as add_issue_dependency). Succeeds when the link does not exist.',
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
      app: 'issue',
      kind: 'write',
      hints: { destructive: false, idempotent: true },
      description:
        'Watches an issue so the caller is notified of its comments and status/priority changes. Project members only; already watching is a no-op.',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        await client.watchIssue(issueKey);
        return 'ok';
      },
    },
    {
      name: 'unwatch_issue',
      app: 'issue',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Stops watching an issue. Succeeds when not watching.',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        await client.unwatchIssue(issueKey);
        return 'ok';
      },
    },
  ];
}
