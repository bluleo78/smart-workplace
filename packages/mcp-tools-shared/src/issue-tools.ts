// src/issue-tools.ts — 두 앱 공유 이슈 도구 10종(WP-421: watch_issue·unwatch_issue 를 watch_issue 하나로 합침). 핸들러는 IssueToolClient(issueKey 기준)만 호출.
import { normalizeTimezone } from './calendar-tools.js';
import { dropEmpty } from './compact.js';
import { errText, parseIssueKey } from './parse.js';
import type { SharedTool } from './mcp-tool.js';
import { ISSUE_DETAIL_COMMENT_HARD_LIMIT, ISSUE_DETAIL_COMMENT_LIMIT, ISSUE_DETAIL_HISTORY_LIMIT, normalizeIssueDetail } from './issue-detail.js';
import { toAgentWorkView } from './agent-work-view.js';
import { toAuthorView, toSeoulIso } from './issue-view.js';
import { toIssueListItem } from './project-tools.js';
import {
  createdLabelsField,
  fieldDefByName,
  splitLabelNames,
  resolveAssigneeIds,
  resolveCycleIds,
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
  reportAgentWorkInput,
  updateIssueInput,
  watchIssueInput,
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
        'Creates an issue (이슈) in projectKey and returns it. type, milestone, cycles and assignees (usernames, "me" = caller) are names ' +
        'from get_project; unknown ones fail before creating, listing allowed values. labels are names too, but unknown label names are ' +
        'created (gray) and listed in createdLabels. fileIds attach staged files. New assignees are notified; an assigned AI agent starts working, ' +
        'except one whose agentRuntime is INTERNAL — it does not react to anything another AI does (assigning, comments, status).',
      inputSchema: createIssueInput,
      async handler(args) {
        const { projectKey, type, assignees, parent, labels, milestone, cycles, ...rest } = createIssueInput.parse(args);
        // 리졸브(이름→ID)를 create 이전에 수행 — 실패 시 이슈를 만들지 않고 throw. 서로 독립 조회라 병렬로 보낸다.
        // WP-356: 라벨·마일스톤·사이클도 서버가 생성과 같은 트랜잭션에서 붙인다 — 생성 후 update_issue 를 따로 부르지 않아도 된다.
        const parentNumber = parent != null ? parentNumberOf(parent, projectKey) : undefined;
        const [typeId, assigneeIds, milestoneId, cycleIds, existingLabels] = await Promise.all([
          type ? resolveTypeId(client, projectKey, type) : undefined,
          assignees ? resolveAssigneeIds(client, projectKey, assignees) : undefined,
          milestone ? resolveMilestoneId(client, projectKey, milestone) : undefined,
          cycles?.length ? resolveCycleIds(client, projectKey, cycles) : undefined,
          labels?.length ? client.getProjectLabels(projectKey) : undefined,
        ]);
        // WP-394: 있는 라벨은 id, 없는 라벨은 이름으로 — 없는 라벨은 서버가 이슈 생성과 같은 트랜잭션에서 만든다(실패하면 라벨도 남지 않는다).
        const labelPart = existingLabels && labels ? splitLabelNames(labels, existingLabels) : undefined;
        // undefined 는 JSON 직렬화에서 빠진다 — 준 값만 서버로 간다.
        const body = {
          ...rest,
          typeId,
          assigneeIds,
          parentNumber,
          labelIds: labelPart?.ids,
          labelNames: labelPart?.created,
          milestoneId,
          cycleIds,
        };
        // 서버 응답(IssueResponse)은 reporterId·assignees[].id 같은 숫자 사용자 ID 를 담는다 — 목록 행과 같은 뷰로 바꿔 내보낸다(#833, WP-353).
        const created = toIssueListItem((await client.createIssue(projectKey, body)) as IssueRow);
        return JSON.stringify(dropEmpty({ ...created, ...createdLabelsField(labelPart) }));
      },
    },
    {
      name: 'update_issue',
      app: 'issue',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Updates an issue (이슈); only given fields change. assignees (usernames, "me" = caller), labels and cycles replace the set ([] clears). ' +
        'Names (type, milestone, cycles, fields) come from get_project; unknown ones fail before any write. Unknown label names are created ' +
        '(gray) and listed in createdLabels. fileIds attach staged files. Then each part saves on its own: {ok, results, createdLabels?}. Status/priority changes notify ' +
        'assignees and watchers, new assignees too. An AI whose agentRuntime is INTERNAL does not react to anything another AI does (assigning, comments, status).',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, type, parent, assignees, labels, milestone, cycles, fields, driveFileId, fileIds, ...rest } = updateIssueInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);

        // 1) 리졸브를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        //    서로 독립 조회라 병렬로 보낸다. 부모 키 → 번호 변환(같은 프로젝트 검사)도 여기서 한다.
        //    WP-356: 커스텀 필드는 이름 → 정의를 찾고 값 모양·선택지까지 확인한다(서버 검증과 같다, null 은 비우기).
        const parentNumber = parent === undefined || parent === null ? parent : parentNumberOf(parent, projectKey);
        const fieldEntries = fields ? Object.entries(fields) : [];
        const [typeId, assigneeIds, existingLabels, milestoneId, cycleIds, fieldValues] = await Promise.all([
          type ? resolveTypeId(client, projectKey, type) : undefined,
          assignees ? resolveAssigneeIds(client, projectKey, assignees) : undefined,
          labels?.length ? client.getProjectLabels(projectKey) : undefined,
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

        // WP-394: 있는 라벨은 id, 없는 라벨은 이름으로 — 없는 라벨은 서버가 라벨 교체와 같은 트랜잭션에서 만든다. [] 는 비우기라 조회 없이 바로 비운다.
        const labelPart = labels ? splitLabelNames(labels, existingLabels ?? []) : undefined;

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

        // 작업 쓰기(첨부 클레임·드라이브 링크)는 내용(상태 포함) PATCH 보다 먼저 한다 — 이들도 서버에서 이슈 수정 알림(상태 미기재)을 내
        // 담당 AI 작업의 자동 상태 전환을 일으킬 수 있다. 같은 호출에서 명시한 status 가 마지막에 저장되어 그 전환에 덮이지 않게 한다.
        // WP-422: 스테이징 파일 첨부 — 빈 배열이면 서버를 부르지 않는다. 실패(만료 등)는 attachments 결과로만 알린다.
        if (fileIds?.length) await run('attachments', () => client.claimIssueAttachments(issueKey, fileIds));
        if (driveFileId !== undefined) await run('driveLink', () => client.addIssueDriveLink(issueKey, driveFileId));

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
        if (labelPart !== undefined) {
          await run('labels', () => client.replaceIssueLabels(issueKey, labelPart.ids, labelPart.created));
        }
        if (cycleIds !== undefined) await run('cycles', () => client.replaceIssueCycles(issueKey, cycleIds));
        if (fieldValues !== undefined) await run('fields', () => client.updateIssueFields(issueKey, fieldValues));

        const ok = Object.values(results).every((v) => v === 'ok');
        // 라벨 교체가 실패했으면 라벨도 만들어지지 않았다 — 성공했을 때만 새 라벨을 알린다.
        return JSON.stringify({ ok, results, ...(results.labels === 'ok' ? createdLabelsField(labelPart) : {}) });
      },
    },
    {
      name: 'report_agent_work',
      app: 'issue',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Reports work on your assigned issue (이슈) at start/on change: INPUT_REQUIRED before asking the user, AUTH_REQUIRED if you need ' +
        'credentials/permission, REVIEW done awaiting review, BLOCKED + why, SCHEDULED yield until nextRunAt (resend each time; none = resume after other work), PAUSED if told to stop; COMPLETED/FAILED/CANCELED/REJECTED end the ' +
        'work. message posts to issue chat; fileIds attach staged files to it.',
      inputSchema: reportAgentWorkInput,
      async handler(args) {
        const { issueKey, nextRunAt, ...rest } = reportAgentWorkInput.parse(args);
        // 오프셋 없는 시각은 서버가 못 읽어 캘린더 도구처럼 +09:00 로 보정해 보낸다.
        const body = nextRunAt === undefined ? rest : { ...rest, nextRunAt: normalizeTimezone(nextRunAt) };
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
        `Replaces an issue comment body (its author only; a project OWNER can delete but not edit others' comments). commentId: comments[].id from get_issue_detail ` +
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
      // WP-421: 구독·해제를 합쳤다 — watching 이 최종 상태라 멱등이고(서버 POST·DELETE 모두 이미 그 상태면 no-op), 해제 갈래가 있어 destructive.
      hints: { destructive: true, idempotent: true },
      description:
        'Watches or stops watching an issue; watchers are notified of its comments and status/priority changes. Anyone who can read the issue (public intake: non-members too); ' +
        'repeating is a no-op.',
      inputSchema: watchIssueInput,
      async handler(args) {
        const { issueKey, watching } = watchIssueInput.parse(args);
        if (watching) await client.watchIssue(issueKey);
        else await client.unwatchIssue(issueKey);
        return 'ok';
      },
    },
  ];
}
