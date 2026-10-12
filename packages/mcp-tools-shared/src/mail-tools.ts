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
  folder: z.string().default('INBOX'),
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
      description: '내 메일 계정 목록을 JSON 으로 반환합니다. 메일 도구에 넘길 accountId 를 모를 때 먼저 호출해 확인하세요.',
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
        '메일 계정의 폴더 메시지 목록을 JSON 배열로 반환합니다(항목: id·fromAddress·fromName·subject·snippet·receivedAt·seen·hasAttachment·aiCategory·aiNeedsReply). ' +
        'folder 기본 INBOX, limit 기본 20, query 로 내용 검색(제목/발신/스니펫). 값이 없는 키(분류 전 메일의 aiCategory·aiNeedsReply)는 생략되고, ' +
        '"분류 전" 인 메일만 categoryPending:true 가 붙습니다. 회신 필요는 aiNeedsReply 가 true 이고 seen 이 false 인 메일입니다. ' +
        '안 읽은 메일만 보려면 query 에 "is:unread" 같은 검색어를 쓰지 말고 unreadOnly:true 를 사용하세요. accountId 는 list_mail_accounts 의 id 입니다.',
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
        '단일 메일을 JSON 으로 반환합니다. 본문은 평문 bodyText 하나로 옵니다(HTML 전용 메일은 HTML 을 평문으로 바꿔 채우며, 서식·링크 주소·이미지는 없습니다). ' +
        '조회만으로는 읽음 처리되지 않습니다(읽음 처리는 mark_mail_read). messageId 는 list_mail 결과 항목의 id 입니다.',
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
        '메일 한 통의 AI 요약을 JSON({summary})으로 반환합니다. 긴 메일·스레드를 빠르게 파악할 때 get_mail 대신 쓰세요. ' +
        'AI 가 설정되지 않았으면 오류가 납니다.',
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
        '메일에 대한 AI 답장 초안 본문을 JSON({draftBody})으로 반환합니다. 저장하거나 보내지 않습니다 — 보내려면 사용자에게 보여주고 발송은 따로 요청받으세요.',
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
        '메일 내용으로 이슈 초안(title·body·priority)과 추천 프로젝트(suggestedProjectKey·candidateProjects)를 JSON 으로 반환합니다. 이슈는 만들지 않습니다 — ' +
        '사용자와 내용을 확정한 뒤 create_issue_from_mail 로 만드세요.',
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
        '메일을 이슈로 등록하고 메일과 이슈를 서로 연결합니다. assignees 는 프로젝트 멤버 username 배열입니다("me"=나, 호출자 본인). ' +
        '이미 이 메일로 만든 이슈가 있으면 새로 만들지 않고 그 issueKey 를 알려줍니다. 결과 { issueKey, created } 를 반환합니다.',
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
        '메일을 읽음으로 표시합니다(원본 메일 서버에도 반영). 사용자가 읽음 처리를 명시적으로 요청할 때만 호출하세요. ' +
        '읽으면 "회신 필요" 목록·건수에서도 빠지며, 이 도구 묶음에는 안 읽음으로 되돌리는 도구가 없어 사용자가 메일 화면에서 직접 안 읽음으로 바꿔야 합니다' +
        '(안 읽음이 되면 회신 필요로 다시 잡힙니다). messageId 는 list_mail 결과 항목의 id 입니다.',
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
        '지정 메일 계정의 받은편지함을 연결된 외부 메일 서버(M365 Graph/IMAP)와 수동 동기화합니다. 새 메일을 가져올 뿐 아니라 ' +
        '이미 가져온 메일의 읽음 상태를 서버 값으로 덮어쓰고(IMAP 은 최근 14일·500건까지), M365 는 서버에서 지워진 메일을 로컬에서도 지웁니다. ' +
        '결과는 JSON({fetched, saved, seenChanged})입니다 — saved 는 새로 가져온 메일 수, seenChanged 는 서버 읽음 상태를 따라 바뀐 기존 메일 수, ' +
        'fetched 는 처리한 항목 수입니다. 셋 다 0 이면 새로 들어온 것도 바뀐 것도 없다는 뜻입니다. ' +
        '이미 이 계정을 동기화 중이면 새로 시작하지 않고 { alreadySyncing: true, phase, done, total } 을 돌려주니, 잠시 뒤 다시 호출하거나 list_mail 로 확인하세요. ' +
        'accountId 는 list_mail_accounts 로 확인하세요.',
      inputSchema: syncMailInput,
      async handler(args) {
        const { accountId } = syncMailInput.parse(args);
        // 서버는 이미 동기화 중이면 건수 0·0·0 을 돌려줘 "새 메일 없음" 과 구분되지 않는다 — 진행 상태를 먼저 보고 구분해 알린다.
        const status = await client.getMailSyncStatus(accountId);
        if (status.running) {
          return JSON.stringify({ alreadySyncing: true, phase: status.phase, done: status.done, total: status.total });
        }
        return JSON.stringify(toSyncResultView(await client.syncMail(accountId)));
      },
    },
  ];
}
