// src/mail-tools.ts — 메일 읽기 도구 + 메일 AI(요약·답장 초안·이슈 초안) + 메일→이슈·회신필요 처리. 두 앱 공유(#846, #855).
// 발송은 ai-agent 의 propose_send_mail(확인 카드)만 — 답장 초안 도구는 본문을 돌려줄 뿐 저장·발송하지 않는다.
import { z } from 'zod';
import { dropEmpty, omitKeys } from './compact.js';
import { htmlToText } from './html-text.js';
import type { SharedTool } from './mcp-tool.js';
import {
  createdLabelsField,
  splitLabelNames,
  resolveAssigneeIds,
  resolveTypeId,
  type AssigneeResolverClient,
  type ProjectMetaClient,
} from './resolve.js';
import { ISSUE_BODY_MAX_LENGTH, issuePriorityInput, mailCategoryInput } from './schemas.js';
import type { MailToolClient } from './tool-client.js';

export const listMailInput = z.object({
  accountId: z.number().int().positive(),
  // WP-1681: TRASH = 메일 서버 휴지통(안 읽은 수·요약·AI 에서 빠진 메일). 서버 메일함 이름도 그대로 받으므로 자유 문자열이다 —
  // 없는 이름은 서버가 빈 목록으로 돌려준다.
  folder: z.string().default('INBOX').describe('INBOX, SENT, TRASH'),
  query: z.string().optional(),
  // #466: 안 읽은 메일만. 검색어("is:unread")로 흉내 내면 서버가 본문 검색으로 처리해 결과가 틀린다.
  unreadOnly: z.boolean().optional(),
  // WP-357: 서버 category 는 값을 검증하지 않아 오타가 조용히 빈 목록이 된다 — enum 으로 막는다(값은 서버 EmailMessageRepository.CATEGORIES).
  category: mailCategoryInput.optional().describe('업무 includes unclassified'),
  needsReply: z.boolean().optional().describe('AI-marked, still unread'),
  limit: z.number().int().min(1).max(100).default(20),
});
export const getMailInput = z.object({ messageId: z.number().int().positive() });
export const createIssueFromMailInput = z.object({
  messageId: z.number().int().positive(),
  projectKey: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(ISSUE_BODY_MAX_LENGTH).optional(),
  priority: issuePriorityInput.optional(),
  assignees: z.array(z.string()).optional(), // username[] → assigneeIds
  // WP-356: 유형·라벨 이름(get_project) → id. 서버 승격 요청이 이슈 생성과 같은 트랜잭션에서 붙인다.
  type: z.string().min(1).optional(),
  labels: z.array(z.string()).optional(),
  // WP-954: 보고자 — me(기본) 또는 sender(보낸 사람이 워크스페이스 구성원이고 프로젝트를 볼 수 있어야 함, 아니면 서버 400).
  reporter: z.enum(['me', 'sender']).optional(),
});
// WP-146: 처리완료 도구를 대신하는 명시적 읽음 처리 입력. WP-357: read:false 면 안 읽음으로 되돌린다(짝 도구를 따로 두지 않는다).
export const markMailReadInput = z.object({
  messageId: z.number().int().positive(),
  read: z.boolean().default(true),
});
// WP-1741: 별표 켜기/끄기 입력. mark_mail_read 처럼 짝 도구 대신 flagged:false 로 끈다(기본은 켜기 — 빠뜨려도 별표를 지우지 않는다).
export const flagMailInput = z.object({
  messageId: z.number().int().positive(),
  flagged: z.boolean().default(true),
});
// WP-1681: 한 번에 옮길 수 있는 메일 수 상한 — API MailMoveRequest 의 messageIds 상한과 같다(어긋나면 API 가 400 으로 거절한다).
const MAIL_MOVE_MAX_MESSAGES = 100;

// WP-1681: 휴지통 메일 되살리기 입력. 한 번에 최대 MAIL_MOVE_MAX_MESSAGES 통.
export const restoreMailInput = z.object({
  accountId: z.number().int().positive(),
  messageIds: z.array(z.number().int().positive()).min(1).max(MAIL_MOVE_MAX_MESSAGES),
});
export const syncMailInput = z.object({ accountId: z.number().int().positive() });
// WP-1341: 내 메일 분류 바꾸기 입력. null 은 「비우기」(AI 분류로 되돌리기) 뜻이라 nullAsOmitted 를 쓰지 않고 정의에 null 갈래를 그대로 보인다.
// 생략은 허용하지 않는다 — 모델이 인자를 빠뜨려 의도치 않게 되돌리는 일을 막는다.
export const updateMailCategoryInput = z.object({
  messageId: z.number().int().positive(),
  category: mailCategoryInput.nullable(),
});

type Raw = Record<string, unknown>;

/**
 * 메일 목록 행(EmailMessageSummary) → LLM 뷰(WP-353). 호출자가 이미 아는 accountId 와 쓸 곳 없는 threadId 를 빼고, 값이 없는 키(aiCategory·
 * aiNeedsReply 가 null 인 미분류 메일)를 지운다. categoryPending(분류가 아직 없음 — 분류 전이거나 분류하지 못함)은 true 일 때만 싣는다 — 대부분의 행에서 false 라 반복 노이즈다. categoryFailed(REST 전용 배지 title 용)는 LLM 에 낼 이유가 없어 늘 뺀다(WP-1347).
 * 회신 필요 = aiNeedsReply 가 true 이고 seen 이 false(서버 단일 술어).
 */
export function toMailListItem(row: Raw): Raw {
  const { categoryPending, flagged, ...rest } = omitKeys(row, 'accountId', 'threadId', 'categoryFailed');
  return dropEmpty({
    ...rest,
    ...(categoryPending === true && { categoryPending: true }),
    // WP-1741: 별표도 대부분 false 라 true 일 때만 싣는다(categoryPending 과 같은 이유).
    ...(flagged === true && { flagged: true }),
  });
}

/**
 * 메일 상세(EmailMessageDetail) → LLM 뷰(WP-353). 본문은 bodyText 하나만 준다 — 서버는 text·html 을 둘 다 보내는데 HTML 은 같은 내용을
 * 태그·인라인 스타일로 부풀린 것이라 토큰만 먹는다. 평문이 비어 있고 HTML 만 있는 메일(HTML 전용 발송)은 HTML 을 평문으로 바꿔 채운다.
 * 헤더 메시지 id(messageId)·스레드 id 는 답장 헤더용 내부 값이라 뺀다. 첨부의 인라인 이미지 참조(contentId)도 빼고, 첨부 id 는 attachmentId 로 이름을 바꾼다(WP-358).
 */
export function toMailDetailView(raw: Raw): Raw {
  const { bodyText, bodyHtml, attachments, ...rest } = omitKeys(raw, 'threadId', 'messageId');
  const text = typeof bodyText === 'string' ? bodyText : '';
  const html = typeof bodyHtml === 'string' ? bodyHtml : '';
  const body = text.trim() === '' && html.trim() !== '' ? htmlToText(html) : text;
  return dropEmpty({
    ...rest,
    bodyText: body,
    // 첨부 식별자는 이슈 첨부와 같은 이름 attachmentId 로 준다(read_file 입력, WP-358).
    attachments: Array.isArray(attachments)
      ? attachments.map((a) => {
          const { id, ...row } = omitKeys(a as Raw, 'contentId');
          return { attachmentId: id, ...row };
        })
      : attachments,
  });
}

/**
 * sync_mail 결과 → LLM 뷰(WP-353). 서버 MailSyncResult 의 건수(fetched 처리 항목, saved 새로 적재, seenChanged 읽음 상태 반영)를 그대로 준다 —
 * 예전에는 결과를 버리고 늘 "완료" 만 돌려줘 새 메일이 있었는지 알 수 없었다.
 */
export function toSyncResultView(raw: unknown): { fetched: number; saved: number; seenChanged: number } {
  const r = (raw ?? {}) as Raw;
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { fetched: n(r.fetched), saved: n(r.saved), seenChanged: n(r.seenChanged) };
}

/**
 * 메일 도구(list_mail_accounts/list_mail/get_mail/get_mail_summary/draft_mail_reply/draft_issue_from_mail/
 * create_issue_from_mail/mark_mail_read/flag_mail/update_mail_category/sync_mail). 모두 내 메일만 다룬다(남의 메일이면 서버가 404).
 */
export function buildMailTools(
  client: MailToolClient & AssigneeResolverClient & Pick<ProjectMetaClient, 'getProjectTypes' | 'getProjectLabels'>,
): SharedTool[] {
  return [
    {
      name: 'list_mail_accounts',
      app: 'mail',
      kind: 'read',
      description:
        'Lists my mail (메일) accounts; id = accountId of other mail tools.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listMailAccounts());
      },
    },
    {
      name: 'list_mail',
      app: 'mail',
      kind: 'read',
      description:
        'Lists mail in an account folder, newest first, up to limit, no paging. id = messageId; ' +
        'categoryPending:true = unclassified or failed; flagged:true = starred. query matches sender (substring), subject/body words; for unread use ' +
        'unreadOnly, not "is:unread".',
      inputSchema: listMailInput,
      async handler(args) {
        const { accountId, folder, limit, query, unreadOnly, category, needsReply } = listMailInput.parse(args);
        const rows = (await client.listMail(accountId, { folder, limit, query, unread: unreadOnly, category, needsReply })) as Raw[];
        return JSON.stringify(Array.isArray(rows) ? rows.map(toMailListItem) : rows);
      },
    },
    {
      name: 'get_mail',
      app: 'mail',
      kind: 'read',
      description:
        'One mail by messageId: plain-text bodyText (HTML-only mail converted, no formatting, link URLs, ' +
        'images) and attachments. issueKey: issue made from it, if any. Does not mark it read.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        // 연결 이슈는 부가 정보라 조회 실패가 메일 읽기를 막지 않는다(없으면 issueKey 를 생략).
        const [mail, linked] = await Promise.all([client.getMail(messageId), client.getMailLinkedIssue(messageId).catch(() => null)]);
        return JSON.stringify({ ...toMailDetailView(mail as Raw), ...(linked && { issueKey: linked.issueKey }) });
      },
    },
    // AI 세 도구는 메일·사용자 데이터를 바꾸지 않아 read 다(요약은 서버 캐시만 채운다). 단 LLM 호출 비용이 든다.
    {
      name: 'get_mail_summary',
      app: 'mail',
      kind: 'read',
      description:
        'AI summary of one mail; quicker than get_mail for long mail.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(await client.getMailSummary(messageId));
      },
    },
    {
      name: 'draft_mail_reply',
      app: 'mail',
      kind: 'read',
      description:
        'Returns an AI-drafted reply as {draftBody}. Saves or sends nothing (no send tool): show the draft to the user.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(await client.draftMailReply(messageId));
      },
    },
    {
      name: 'draft_issue_from_mail',
      app: 'mail',
      kind: 'read',
      description:
        'Drafts an issue from a mail: {title, body, priority, suggestedProjectKey, candidateProjects (senderSelectable, senderDefault), sender}. ' +
        'Creates nothing; confirm with the user (reporter: me or sender; per-project default senderDefault), then ' +
        'create_issue_from_mail.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(await client.draftIssueFromMail(messageId));
      },
    },
    {
      name: 'create_issue_from_mail',
      app: 'mail',
      kind: 'write',
      // 이미 이 메일로 만든 이슈가 있으면 새로 만들지 않고 기존 키를 돌려준다 — 멱등.
      hints: { destructive: false, idempotent: true },
      description:
        'Creates an issue (이슈) from a mail. assignees: project member usernames ("me" = caller), notified; type, labels: ' +
        'project names (unknown labels created, gray; createdLabels). reporter: me (default) or sender (a workspace member ' +
        'who can see the project). Returns {issueKey, created}; created:false = the mail\'s existing issue.',
      inputSchema: createIssueFromMailInput,
      async handler(args) {
        const { messageId, assignees, type, labels, reporter, ...rest } = createIssueFromMailInput.parse(args);
        // 이름 → id 해석을 승격 전에 모두 끝낸다 — 하나라도 실패하면 이슈를 만들지 않는다(서로 독립 조회라 병렬).
        const [assigneeIds, typeId, existingLabels] = await Promise.all([
          assignees ? resolveAssigneeIds(client, rest.projectKey, assignees) : undefined,
          type ? resolveTypeId(client, rest.projectKey, type) : undefined,
          labels?.length ? client.getProjectLabels(rest.projectKey) : undefined,
        ]);
        // WP-394: 있는 라벨은 id, 없는 라벨은 이름으로 — 없는 라벨은 서버가 이슈와 같은 트랜잭션에서 만든다(이미 승격된 메일이면 만들지 않는다).
        const labelPart = existingLabels && labels ? splitLabelNames(labels, existingLabels) : undefined;
        try {
          const { issueKey } = await client.promoteMailToIssue(messageId, {
            ...rest,
            assigneeIds,
            typeId,
            labelIds: labelPart?.ids,
            labelNames: labelPart?.created,
            // WP-954: 보낸 사람만 싣는다 — 생략은 나(서버 기본).
            ...(reporter === 'sender' ? { reporter: 'SENDER' as const } : {}),
          });
          return JSON.stringify({ issueKey, created: true, ...createdLabelsField(labelPart) });
        } catch (e) {
          // 중복은 서버가 메일 행 잠금으로 원자적으로 막고 409 로 알린다(#859) — 기존 연결 이슈를 찾아 안내한다.
          if ((e as { response?: { status?: number } })?.response?.status !== 409) throw e;
          const linked = await client.getMailLinkedIssue(messageId);
          if (!linked) throw e;
          return JSON.stringify({ issueKey: linked.issueKey, created: false });
        }
      },
    },
    {
      name: 'mark_mail_read',
      app: 'mail',
      kind: 'write',
      // 읽음 상태가 원본 메일 서버(Graph/IMAP)로 역동기화된다 — 워크스페이스 밖에 닿으므로 openWorld.
      hints: { destructive: true, idempotent: true, openWorld: true },
      description:
        'Marks a mail read (read:false: unread), also on the server; only when asked. Read mail leaves needs-reply; ' +
        'unread AI-marked mail joins it.',
      inputSchema: markMailReadInput,
      async handler(args) {
        const { messageId, read } = markMailReadInput.parse(args);
        await (read ? client.markMailRead(messageId) : client.markMailUnread(messageId));
        return 'ok';
      },
    },
    {
      name: 'flag_mail',
      app: 'mail',
      kind: 'write',
      // WP-1741: 별표가 원본 메일 서버(IMAP \Flagged·Graph flag)로 역동기화된다 — mark_mail_read 와 같은 이유로 openWorld·destructive(서버 값을 덮는다)·멱등.
      hints: { destructive: true, idempotent: true, openWorld: true },
      description: 'Stars a mail (flagged:false: unstars), also on the server; only when asked.',
      inputSchema: flagMailInput,
      async handler(args) {
        const { messageId, flagged } = flagMailInput.parse(args);
        await client.setMailFlagged(messageId, flagged);
        return 'ok';
      },
    },
    {
      name: 'restore_mail',
      app: 'mail',
      kind: 'write',
      // WP-1681: 휴지통에서 원래 메일함(없으면 받은편지함)으로 옮긴다. 메일 서버에도 반영돼 openWorld. 메일을 지우지 않고 되돌릴 수 있어(다시 지우면 휴지통)
      // destructive 가 아니며, 이미 되살린 메일은 서버가 400 으로 거절해 같은 인자를 다시 불러도 결과가 같지 않으므로 멱등이 아니다.
      hints: { destructive: false, idempotent: false, openWorld: true },
      description:
        'Restores trashed mail (list_mail folder:TRASH) to its original folder (else the inbox), also on the server. Returns {results:[{messageId, ok, error?}]}.',
      inputSchema: restoreMailInput,
      async handler(args) {
        const { accountId, messageIds } = restoreMailInput.parse(args);
        return JSON.stringify(await client.restoreMail(accountId, messageIds));
      },
    },
    {
      name: 'update_mail_category',
      app: 'mail',
      kind: 'write',
      // WP-1341: 내 사본(email_message.user_category)만 바꾼다 — 같은 메일을 받은 동료의 분류는 그대로다. null 로 AI 분류에 되돌릴 수 있어
      // destructive 가 아니고, 같은 값을 다시 보내도 결과가 같아 멱등이다. 원본 메일 서버에는 닿지 않는다.
      hints: { destructive: false, idempotent: true, openWorld: false },
      description: 'Sets my category for one mail; null = back to the AI category.',
      inputSchema: updateMailCategoryInput,
      async handler(args) {
        const { messageId, category } = updateMailCategoryInput.parse(args);
        // 응답의 learnable(웹이 교정 학습을 부를지 정하는 값)은 도구 쓰임새가 없어 뺀다 — 대화에서는 라우터가 기억을 직접 남긴다.
        const { aiCategory, categoryByMe } = await client.setMailCategory(messageId, category);
        return JSON.stringify({ aiCategory, categoryByMe });
      },
    },
    {
      name: 'sync_mail',
      app: 'mail',
      kind: 'write',
      // 원본 메일 서버(IMAP/Graph)에 접속하므로 openWorld. 새 메일을 적재하는 데 그치지 않고 기존 로컬 메일의 읽음 상태를 서버 값으로
      // 덮어쓰며(WP-148, mark_mail_read 와 같은 이유로 destructive) Graph 는 서버에서 지워진 항목을 로컬에서도 지운다.
      // 호출마다 last_synced_at 이 갱신되고 그 사이 도착한 메일 때문에 같은 인자도 결과가 달라지므로 멱등이 아니다(true 는 자동 재시도를 부른다).
      hints: { destructive: true, idempotent: false, openWorld: true },
      description:
        'Syncs an account inbox with its server (M365/IMAP): fetches new mail, overwrites read/star states (IMAP: last 14 days, 500 ' +
        'items); M365 also deletes mail removed there. Returns {fetched, saved (new), seenChanged}; all 0 = no change (best effort: or a ' +
        'sync just started). Already running: {alreadySyncing:true, phase, done, total}; retry later or use list_mail.',
      inputSchema: syncMailInput,
      async handler(args) {
        const { accountId } = syncMailInput.parse(args);
        // 서버는 이미 동기화 중이면 건수 0·0·0 을 돌려줘 "새 메일 없음" 과 구분되지 않는다 — 진행 상태를 먼저 보고 구분해 알린다.
        // best-effort: 확인과 호출 사이에 다른 동기화가 시작되면 서버가 0·0·0 을 돌려 "새것 없음" 으로 읽힌다. 호출 뒤에 다시 확인하지 않는 이유는
        // 본문 백필이 BODIES 단계에서 running 을 남겨 우리 자신의 동기화를 "이미 동기화 중" 으로 오판하기 때문이다.
        const status = await client.getMailSyncStatus(accountId);
        if (status.running) {
          return JSON.stringify({ alreadySyncing: true, phase: status.phase, done: status.done, total: status.total });
        }
        return JSON.stringify(toSyncResultView(await client.syncMail(accountId)));
      },
    },
  ];
}
