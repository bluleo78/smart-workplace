// src/mail-tools.ts — 메일 읽기 도구 + 메일 AI(요약·답장 초안·이슈 초안) + 메일→이슈·회신필요 처리. 두 앱 공유(#846, #855).
// 발송은 ai-agent 의 propose_send_mail(확인 카드)만 — 답장 초안 도구는 본문을 돌려줄 뿐 저장·발송하지 않는다.
import { z } from 'zod';
import { dropEmpty, omitKeys } from './compact.js';
import { htmlToText } from './html-text.js';
import type { SharedTool } from './mcp-tool.js';
import { resolveAssigneeIds, type AssigneeResolverClient } from './resolve.js';
import type { MailToolClient } from './tool-client.js';

export const listMailInput = z.object({
  accountId: z.number().int().positive(),
  folder: z.string().default('INBOX').describe('INBOX or SENT'),
  query: z.string().optional(),
  // #466: 안 읽은 메일만. 검색어("is:unread")로 흉내 내면 서버가 본문 검색으로 처리해 결과가 틀린다.
  unreadOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export const getMailInput = z.object({ messageId: z.number().int().positive() });
export const createIssueFromMailInput = z.object({
  messageId: z.number().int().positive(),
  projectKey: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  assignees: z.array(z.string()).optional(), // username[] → assigneeIds
});
// WP-146: 처리완료 도구를 대신하는 명시적 읽음 처리 입력
export const markMailReadInput = z.object({ messageId: z.number().int().positive() });
export const syncMailInput = z.object({ accountId: z.number().int().positive() });

type Raw = Record<string, unknown>;

/**
 * 메일 목록 행(EmailMessageSummary) → LLM 뷰(WP-353). 호출자가 이미 아는 accountId 와 쓸 곳 없는 threadId 를 빼고, 값이 없는 키(aiCategory·
 * aiNeedsReply 가 null 인 미분류 메일)를 지운다. categoryPending 은 "분류 전" 일 때(true)만 싣는다 — 대부분의 행에서 false 라 반복 노이즈다.
 * 회신 필요 = aiNeedsReply 가 true 이고 seen 이 false(서버 단일 술어).
 */
export function toMailListItem(row: Raw): Raw {
  const { categoryPending, ...rest } = omitKeys(row, 'accountId', 'threadId');
  return dropEmpty({ ...rest, ...(categoryPending === true && { categoryPending: true }) });
}

/**
 * 메일 상세(EmailMessageDetail) → LLM 뷰(WP-353). 본문은 bodyText 하나만 준다 — 서버는 text·html 을 둘 다 보내는데 HTML 은 같은 내용을
 * 태그·인라인 스타일로 부풀린 것이라 토큰만 먹는다. 평문이 비어 있고 HTML 만 있는 메일(HTML 전용 발송)은 HTML 을 평문으로 바꿔 채운다.
 * 헤더 메시지 id(messageId)·스레드 id 는 답장 헤더용 내부 값이라 뺀다. 첨부의 인라인 이미지 참조(contentId)도 뺀다.
 */
export function toMailDetailView(raw: Raw): Raw {
  const { bodyText, bodyHtml, attachments, ...rest } = omitKeys(raw, 'threadId', 'messageId');
  const text = typeof bodyText === 'string' ? bodyText : '';
  const html = typeof bodyHtml === 'string' ? bodyHtml : '';
  const body = text.trim() === '' && html.trim() !== '' ? htmlToText(html) : text;
  return dropEmpty({
    ...rest,
    bodyText: body,
    attachments: Array.isArray(attachments) ? attachments.map((a) => omitKeys(a as Raw, 'contentId')) : attachments,
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
 * create_issue_from_mail/mark_mail_read/sync_mail). 모두 내 메일만 다룬다(남의 메일이면 서버가 404).
 */
export function buildMailTools(client: MailToolClient & AssigneeResolverClient): SharedTool[] {
  return [
    {
      name: 'list_mail_accounts',
      app: 'mail',
      kind: 'read',
      description:
        'Lists my mail (메일) accounts; id is the accountId of other mail tools.',
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
        'Lists mail in a folder of an account (accountId from list_mail_accounts), newest first, up to limit with no further pages. Items: id ' +
        '(messageId), sender, subject, snippet, receivedAt, seen, hasAttachment, aiCategory, aiNeedsReply (categoryPending:true while unclassified). ' +
        'query matches sender (substring) and subject/body words; for unread mail use unreadOnly, not "is:unread". Needs reply = aiNeedsReply and not ' +
        'seen.',
      inputSchema: listMailInput,
      async handler(args) {
        const { accountId, folder, limit, query, unreadOnly } = listMailInput.parse(args);
        const rows = (await client.listMail(accountId, { folder, limit, query, unread: unreadOnly })) as Raw[];
        return JSON.stringify(Array.isArray(rows) ? rows.map(toMailListItem) : rows);
      },
    },
    {
      name: 'get_mail',
      app: 'mail',
      kind: 'read',
      description:
        'Returns one mail by messageId (id from list_mail) with plain-text bodyText (HTML-only mail is converted, without formatting, link URLs or ' +
        'images) and attachments. Does not mark it read.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(toMailDetailView((await client.getMail(messageId)) as Raw));
      },
    },
    // AI 세 도구는 메일·사용자 데이터를 바꾸지 않아 read 다(요약은 서버 캐시만 채운다). 단 LLM 호출 비용이 든다.
    {
      name: 'get_mail_summary',
      app: 'mail',
      kind: 'read',
      description:
        'Returns an AI summary of one mail as {summary}; quicker than get_mail for long mail. Errors if AI is not configured.',
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
        'Returns an AI-drafted reply body as {draftBody}. Nothing is saved or sent (no send tool here): show the draft to the user.',
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
        'Drafts an issue from a mail: {title, body, priority, suggestedProjectKey, candidateProjects}. Creates nothing; confirm with the user, then ' +
        'call create_issue_from_mail.',
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
        'Creates an issue (이슈) from a mail and links the two. assignees are project member usernames ("me" = caller) and are notified. If the mail ' +
        'already has an issue, nothing is created and that issueKey returns. Returns {issueKey, created}.',
      inputSchema: createIssueFromMailInput,
      async handler(args) {
        const { messageId, assignees, ...rest } = createIssueFromMailInput.parse(args);
        const assigneeIds = assignees ? await resolveAssigneeIds(client, rest.projectKey, assignees) : undefined;
        try {
          const { issueKey } = await client.promoteMailToIssue(messageId, { ...rest, assigneeIds });
          return JSON.stringify({ issueKey, created: true });
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
        'Marks a mail read, also on the mail server; only when the user asks. It leaves the needs-reply list, and no tool here marks it unread again.',
      inputSchema: markMailReadInput,
      async handler(args) {
        const { messageId } = markMailReadInput.parse(args);
        await client.markMailRead(messageId);
        return 'ok';
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
        'Syncs an account inbox with its server (M365 Graph or IMAP) now: fetches new mail, overwrites stored read states with the server values ' +
        '(IMAP: last 14 days, 500 items), and on M365 deletes mail removed there. Returns {fetched, saved (new), seenChanged}; all 0 = no change. If ' +
        'a sync is already running it returns {alreadySyncing:true, phase, done, total}: retry later or use list_mail. That check is best effort; a ' +
        'sync starting right after it can also yield all 0.',
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
