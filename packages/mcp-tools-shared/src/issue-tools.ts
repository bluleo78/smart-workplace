// src/issue-tools.ts — 두 앱 공유 이슈 도구 13종(WP-800: claim_issue 추가, WP-421: watch_issue·unwatch_issue 를 watch_issue 하나로 합침). 핸들러는 IssueToolClient(issueKey 기준)만 호출.
import { normalizeTimezone } from './calendar-tools.js';
import { dropEmpty } from './compact.js';
import { errText, parseIssueKey } from './parse.js';
import type { SharedTool } from './mcp-tool.js';
import { ISSUE_DETAIL_COMMENT_HARD_LIMIT, ISSUE_DETAIL_COMMENT_LIMIT, ISSUE_DETAIL_HISTORY_LIMIT, normalizeIssueDetail } from './issue-detail.js';
import { toAgentWorkView } from './agent-work-view.js';
import { labelNames, toAuthorView, toPeopleView, toSeoulIso } from './issue-view.js';
import { toIssueListItem } from './project-tools.js';
import {
  createdLabelsField,
  fieldDefByName,
  splitLabelNames,
  resolveAssigneeIds,
  resolveCycleIds,
  resolveMilestoneId,
  resolveRelationType,
  resolveStatusPatch,
  resolveTypeId,
  toFieldValue,
  unknownStatusMessage,
} from './resolve.js';
import {
  addCommentInput,
  addIssueRelationInput,
  claimIssueInput,
  createIssueInput,
  linkIssuesInput,
  editCommentInput,
  getIssueChatInput,
  getIssueDetailInput,
  removeIssueRelationInput,
  reportAgentWorkInput,
  updateIssueInput,
  watchIssueInput,
} from './schemas.js';
import { resolveMentionTokens } from './messaging-tools.js';
import type { IssueRelationTypeRow, IssueRow, IssueToolClient } from './tool-client.js';

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

/** 관계 유형 목록 → id 별 이름(WP-887) — 상세·추가 결과의 사용자 정의 유형 type 을 이름으로 채울 때 쓴다. */
const relationTypeNames = (types: IssueRelationTypeRow[]): Map<number, string> => new Map(types.map((t) => [t.id, t.name]));

/**
 * 상세 raw 의 관계·외부 링크 중 코드 없는(사용자 정의) 유형이 있을 때만 유형 목록을 읽어 이름 표를 만든다 — 기본 유형만 쓰는 대부분의 이슈는 조회가 늘지 않는다.
 * 유형 조회가 실패해도 상세 자체는 돌려준다: 그 경우 type 은 이 이슈 쪽 말로 대신한다(이 값은 표시용이고 쓰기는 relationId·externalLinkId 로 한다).
 */
async function customRelationTypeNames(client: IssueToolClient, raw: unknown): Promise<Map<number, string> | undefined> {
  const r = (raw ?? {}) as { relations?: { typeCode?: string | null }[]; externalLinks?: { typeCode?: string | null }[] };
  const needsNames = [...(r.relations ?? []), ...(r.externalLinks ?? [])].some((v) => !v.typeCode);
  if (!needsNames) return undefined;
  try {
    return relationTypeNames(await client.listIssueRelationTypes());
  } catch {
    return undefined;
  }
}

/** 공유 이슈 도구 13종 구성. 각 앱은 자기 클라이언트를 IssueToolClient 로 어댑팅해 넘긴다. */
export function buildSharedIssueTools(client: IssueToolClient): SharedTool[] {
  return [
    {
      name: 'get_issue_detail',
      app: 'issue',
      kind: 'read',
      description:
        'Returns one issue (이슈) by issueKey (e.g. WP-12): Markdown body, all fields (dates +09:00), cycles, parent, children, blockedBy/blocks, ' +
        'relations and externalLinks (non-blocking links, with ids for remove_issue_relation), ' +
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
        const detail = normalizeIssueDetail(raw, { allComments, relationTypeNames: await customRelationTypeNames(client, raw) });
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
        'reporter (username) changes the reporter: project OWNER/ADMIN or the current reporter only, humans only. ' +
        'Names (type, milestone, cycles, fields) come from get_project; unknown ones fail before any write. Unknown label names are created ' +
        '(gray) and listed in createdLabels. fileIds attach staged files. Then each part saves on its own: {ok, results, createdLabels?}; an unknown status name fails results.content (listing valid ones) and nothing else is written. Status/priority changes notify ' +
        'assignees and watchers, new assignees too. An AI whose agentRuntime is INTERNAL does not react to anything another AI does (assigning, comments, status).',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, status, type, parent, assignees, reporter, labels, milestone, cycles, fields, driveFileId, fileIds, ...rest } = updateIssueInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);

        // 1) 리졸브를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        //    서로 독립 조회라 병렬로 보낸다. 부모 키 → 번호 변환(같은 프로젝트 검사)도 여기서 한다.
        //    WP-356: 커스텀 필드는 이름 → 정의를 찾고 값 모양·선택지까지 확인한다(서버 검증과 같다, null 은 비우기).
        const parentNumber = parent === undefined || parent === null ? parent : parentNumberOf(parent, projectKey);
        const fieldEntries = fields ? Object.entries(fields) : [];
        //    WP-870: status 는 범주면 { status }, 프로젝트 상태 이름이면 { statusName } — 이름은 서버가 해석하고 모르면 content 가 400 으로 실패한다.
        const statusPatch = status !== undefined ? resolveStatusPatch(status) : undefined;
        const [typeId, assigneeIds, existingLabels, milestoneId, cycleIds, fieldValues, reporterIds] = await Promise.all([
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
          // WP-944: 보고자도 담당자와 같은 이름 해석(프로젝트 멤버 username, "me")을 쓴다.
          reporter ? resolveAssigneeIds(client, projectKey, [reporter]) : undefined,
        ]);

        // WP-394: 있는 라벨은 id, 없는 라벨은 이름으로 — 없는 라벨은 서버가 라벨 교체와 같은 트랜잭션에서 만든다. [] 는 비우기라 조회 없이 바로 비운다.
        const labelPart = labels ? splitLabelNames(labels, existingLabels ?? []) : undefined;

        // 2) 필드별 팬아웃 — 각 단계 독립 저장, 성공/실패 구조화.
        const results: Record<string, string> = {};

        // 모르는 상태 이름은 어떤 쓰기보다 먼저 실패해야 한다 — 담당자·라벨 등만 바뀐 반쯤 고친 이슈를 남기지 않게.
        // 이름은 서버가 내용 PATCH 에서 해석·거절하므로 보통은 내용 PATCH 를 맨 앞에 두는 것으로 충분하다(아래 contentFirst).
        // 다만 첨부·드라이브 링크는 상태보다 먼저 저장해야 해(아래 주석) 내용 PATCH 를 앞당길 수 없다 — 그때만 상태 목록으로 이름을 먼저 확인한다.
        const statusName = statusPatch && 'statusName' in statusPatch ? statusPatch.statusName : undefined;
        const writesBeforeContent = !!fileIds?.length || driveFileId !== undefined;
        if (statusName !== undefined && writesBeforeContent) {
          const unknown = await unknownStatusMessage(client, projectKey, statusName);
          if (unknown) return JSON.stringify({ ok: false, results: { content: `failed: ${unknown}` } });
        }
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
        const content: Record<string, unknown> = { ...rest, ...statusPatch };
        if (milestoneId !== undefined) content.milestoneId = milestoneId;
        if (milestone === null) content.clearMilestone = true;
        if (Object.keys(content).length > 0) {
          await run('content', () => client.updateIssueContent(issueKey, content));
          // 상태 이름을 실은 내용 PATCH 가 실패했으면(모르는 이름 400 등) 나머지는 쓰지 않는다 — 이 앞의 쓰기는 첨부·링크뿐이고 그때는 이름을 미리 확인했다.
          if (statusName !== undefined && results.content !== 'ok') return JSON.stringify({ ok: false, results });
        }
        // WP-745: 유형과 부모를 함께 바꾸면 한 요청으로 보낸다 — SUBTASK 로 바꾸는 순간 부모가 있어야 해서,
        // 유형·부모를 따로 보내면 순서와 상관없이 한쪽이 거절된다. 결과는 type·parent 둘 다에 같은 값으로 싣는다.
        if (typeId !== undefined && typeof parentNumber === 'number') {
          await run('type', () => client.setIssueType(issueKey, typeId, parentNumber));
          results.parent = results.type;
        } else {
          if (typeId !== undefined) await run('type', () => client.setIssueType(issueKey, typeId));
          if (parentNumber !== undefined) await run('parent', () => client.setIssueParent(issueKey, parentNumber));
        }
        if (assigneeIds !== undefined) {
          await run('assignees', () => client.replaceIssueAssignees(issueKey, assigneeIds));
        }
        if (labelPart !== undefined) {
          await run('labels', () => client.replaceIssueLabels(issueKey, labelPart.ids, labelPart.created));
        }
        if (cycleIds !== undefined) await run('cycles', () => client.replaceIssueCycles(issueKey, cycleIds));
        if (fieldValues !== undefined) await run('fields', () => client.updateIssueFields(issueKey, fieldValues));
        // WP-944: 보고자는 맨 마지막 — 쓰기 권한이 지금 보고자를 따르므로(OPEN 비멤버 보고자) 넘긴 뒤의 쓰기는 거절될 수 있다.
        if (reporterIds !== undefined) await run('reporter', () => client.changeIssueReporter(issueKey, reporterIds[0]));

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
      name: 'link_issues',
      app: 'issue',
      kind: 'write',
      // WP-812: 추가·제거를 합쳤다(앱당 도구 16개 상한 안에 react 자리를 만들려고, watch_issue 와 같은 방식). linked 는 최종 상태라 필수이고
      // 서버가 이미 있는 링크 추가·없는 링크 제거를 no-op 으로 처리해 멱등이다. 제거 갈래가 있어 destructive.
      hints: { destructive: true, idempotent: true },
      description:
        'Adds (linked: true) or removes (false) a blocking link between two issues of the same project. direction "blocks": issueKey blocks otherIssueKey; ' +
        '"blockedBy": the reverse. Repeating is a no-op; adding a cycle is an error. Adding returns the issue\'s links.',
      inputSchema: linkIssuesInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction, linked } = linkIssuesInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        if (!linked) {
          await client.removeIssueDependency(issueKey, otherNumber, direction);
          return 'ok';
        }
        // 서버는 갱신된 이슈 상세 전체(코멘트·이력의 숫자 사용자 ID 포함)를 돌려준다 — 이 도구에 필요한 의존성 관계만 정규화해 내보낸다(#833, WP-353).
        const { blockedBy, blocks, blocked } = normalizeIssueDetail(await client.addIssueDependency(issueKey, otherNumber, direction));
        return JSON.stringify({ issueKey, blockedBy, blocks, blocked });
      },
    },
    {
      name: 'add_issue_relation',
      app: 'issue',
      kind: 'write',
      // 같은 관계·같은 외부 링크를 다시 걸면 서버가 건너뛴다(방향 없는 유형은 A·B 를 정규화) — 멱등.
      hints: { destructive: false, idempotent: true },
      description:
        'Links issueKey to another issue (otherIssueKey) or an issue in another system (externalLink: url, key?, title) — exactly one. ' +
        'Not for blocking (link_issues). Reads "this issue <outwardLabel> <other>". Repeating is a no-op. Returns issueKey, relations, externalLinks.',
      inputSchema: addIssueRelationInput,
      async handler(args) {
        const { issueKey, type, side, otherIssueKey, externalLink } = addIssueRelationInput.parse(args);
        // 이슈 사이 관계와 외부 링크는 서버 경로·본문이 달라 한 호출에 하나만 — 둘 다/둘 다 없음은 어느 쪽을 뜻하는지 알 수 없어 쓰기 전에 거부한다.
        if ((otherIssueKey == null) === (externalLink == null)) {
          throw new Error('otherIssueKey(이슈 사이 관계)와 externalLink(다른 시스템 이슈) 중 정확히 하나를 주세요.');
        }
        parseIssueKey(issueKey);
        const types = await client.listIssueRelationTypes();
        const relationType = resolveRelationType(types, type);
        const sideValue = side ?? 'source';
        if (externalLink != null) {
          // 외부 링크에는 차단·외부 전용(상위 에픽) 유형도 쓸 수 있다 — 서버 규칙과 같다.
          await client.addIssueExternalLink(issueKey, { typeId: relationType.id, side: sideValue, url: externalLink.url, key: externalLink.key, title: externalLink.title });
        } else {
          if (relationType.code === 'BLOCKS') throw new Error('차단 관계는 add_issue_relation 이 아니라 link_issues(linked: true) 로 거세요.');
          if (relationType.externalOnly) throw new Error(`관계 유형 '${type}' 은(는) 다른 시스템 이슈 링크(externalLink)에만 쓸 수 있습니다.`);
          const other = parseIssueKey(otherIssueKey!);
          await client.addIssueRelation(issueKey, { typeId: relationType.id, side: sideValue, target: { projectKey: other.projectKey, number: other.number } });
        }
        // 서버 응답은 건 쪽 목록 하나뿐이라, 두 목록을 모두 돌려주려고 상세를 다시 읽는다(숨긴 상대는 서버가 이미 가린다).
        const { relations, externalLinks } = normalizeIssueDetail(await client.getIssueDetail(issueKey), { relationTypeNames: relationTypeNames(types) });
        return JSON.stringify({ issueKey, relations, externalLinks });
      },
    },
    {
      name: 'remove_issue_relation',
      app: 'issue',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Removes a link made by add_issue_relation: exactly one of relationId or externalLinkId, from get_issue_detail. Not for blocking (link_issues).',
      inputSchema: removeIssueRelationInput,
      async handler(args) {
        const { issueKey, relationId, externalLinkId } = removeIssueRelationInput.parse(args);
        if ((relationId == null) === (externalLinkId == null)) {
          throw new Error('relationId 와 externalLinkId 중 정확히 하나를 주세요.');
        }
        parseIssueKey(issueKey);
        if (relationId != null) await client.removeIssueRelation(issueKey, relationId);
        else await client.removeIssueExternalLink(issueKey, externalLinkId!);
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
    {
      name: 'claim_issue',
      app: 'issue',
      kind: 'write',
      // 같은 호출을 되풀이하면 대기열 라벨이 이미 없어 NOT_IN_QUEUE 로 거절된다 — 멱등이 아니다. 라벨을 떼지만 되돌릴 수 있어 destructive 도 아니다.
      hints: { destructive: false, idempotent: false },
      description:
        'Takes a queued issue for you: if it carries queueLabel and has no AI assignee, adds you as assignee (people stay) and removes that label, ' +
        'atomically. Refused (code NOT_IN_QUEUE / AI_ALREADY_ASSIGNED) if another AI got it first.',
      inputSchema: claimIssueInput,
      async handler(args) {
        const { issueKey, queueLabel } = claimIssueInput.parse(args);
        const { assignees, labels } = await client.claimIssue(issueKey, queueLabel);
        // 숫자 userId·라벨 id·색은 빼고 사람을 username 으로, 라벨을 이름으로만 가리킨다(#833).
        return JSON.stringify({
          assignees: toPeopleView(assignees).map((p) => p.username),
          labels: labelNames(labels),
        });
      },
    },
  ];
}
