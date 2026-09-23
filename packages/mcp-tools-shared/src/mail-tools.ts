// src/mail-tools.ts — 메일 읽기 도구 3종. 두 앱 공유(#846). 발송은 ai-agent 의 propose_send_mail(확인 카드)만.
import { z } from 'zod';
import type { McpTool } from './mcp-tool.js';
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

/** 메일 읽기 도구 3종(list_mail_accounts/list_mail/get_mail). */
export function buildMailTools(client: MailToolClient): McpTool[] {
  return [
    {
      name: 'list_mail_accounts',
      description: '내 메일 계정 목록을 JSON 으로 반환합니다. 메일 도구에 넘길 accountId 를 모를 때 먼저 호출해 확인하세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listMailAccounts());
      },
    },
    {
      name: 'list_mail',
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
      description: '단일 메일 본문(텍스트/HTML)을 JSON 으로 반환합니다. messageId 는 list_mail 결과 항목의 id 입니다.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(await client.getMail(messageId));
      },
    },
  ];
}
