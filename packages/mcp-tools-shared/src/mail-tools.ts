// src/mail-tools.ts — 메일 읽기 도구 + 메일 AI(요약·답장 초안·이슈 초안) + 메일→이슈·회신필요 처리. 두 앱 공유(#846, #855).
// 발송은 ai-agent 의 propose_send_mail(확인 카드)만 — 답장 초안 도구는 본문을 돌려줄 뿐 저장·발송하지 않는다.
import { z } from 'zod';
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

/**
 * 메일 도구(list_mail_accounts/list_mail/get_mail/get_mail_summary/draft_mail_reply/draft_issue_from_mail/
 * create_issue_from_mail/mark_mail_read). 모두 내 메일만 다룬다(남의 메일이면 서버가 404).
 */
export function buildMailTools(client: MailToolClient & AssigneeResolverClient): SharedTool[] {
  return [
    {
      name: 'list_mail_accounts',
      kind: 'read',
      description: '내 메일 계정 목록을 JSON 으로 반환합니다. 메일 도구에 넘길 accountId 를 모를 때 먼저 호출해 확인하세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listMailAccounts());
      },
    },
    {
      name: 'list_mail',
      kind: 'read',
      description:
        '메일 계정의 폴더 메시지 목록을 JSON 으로 반환합니다. folder 기본 INBOX, limit 기본 20, query 로 내용 검색(제목/발신/스니펫). ' +
        '안 읽은 메일만 보려면 query 에 "is:unread" 같은 검색어를 쓰지 말고 unreadOnly:true 를 사용하세요. accountId 는 list_mail_accounts 의 id 입니다.',
      inputSchema: listMailInput,
      async handler(args) {
        const { accountId, folder, limit, query, unreadOnly } = listMailInput.parse(args);
        return JSON.stringify(await client.listMail(accountId, { folder, limit, query, unread: unreadOnly }));
      },
    },
    {
      name: 'get_mail',
      kind: 'read',
      description: '단일 메일 본문(텍스트/HTML)을 JSON 으로 반환합니다. messageId 는 list_mail 결과 항목의 id 입니다.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(await client.getMail(messageId));
      },
    },
    // AI 세 도구는 메일·사용자 데이터를 바꾸지 않아 read 다(요약은 서버 캐시만 채운다). 단 LLM 호출 비용이 든다.
    {
      name: 'get_mail_summary',
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
      kind: 'write',
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
      kind: 'write',
      description:
        '메일을 읽음으로 표시합니다. 사용자가 읽음 처리를 명시적으로 요청할 때만 호출하세요. 읽으면 "회신 필요"에서도 빠집니다. messageId 는 list_mail 결과 항목의 id 입니다.',
      inputSchema: markMailReadInput,
      async handler(args) {
        const { messageId } = markMailReadInput.parse(args);
        await client.markMailRead(messageId);
        return 'ok';
      },
    },
  ];
}
