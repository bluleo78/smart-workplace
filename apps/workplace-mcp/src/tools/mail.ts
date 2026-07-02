// src/tools/mail.ts — 메일 도메인 도구. 읽기 전용이다(발송/답장은 후속 태스크 — PAT 로 임의 발신은
// 스푸핑·오발송 위험이 커서 서버측 승인 흐름 없이는 열지 않는다).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 메일 도메인 도구 3종(list_mail_accounts/list_mail/get_mail) 을 구성한다. */
export function buildMailTools(client: PatApiClient): McpTool[] {
  const listMailAccountsInput = z.object({});
  const listMailInput = z.object({
    accountId: z.number().int(),
    folder: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    query: z.string().optional(),
    unread: z.boolean().optional(),
  });
  const getMailInput = z.object({ messageId: z.number().int() });

  return [
    {
      name: 'list_mail_accounts',
      description: '연결된 메일 계정 목록을 JSON 으로 반환합니다.',
      inputSchema: listMailAccountsInput,
      async handler() {
        return JSON.stringify(await client.listMailAccounts());
      },
    },
    {
      name: 'list_mail',
      description:
        '메일 계정의 메시지 목록을 JSON 으로 반환합니다. folder 기본값 INBOX, limit 기본값 20.',
      inputSchema: listMailInput,
      async handler(args) {
        const { accountId, folder, limit, query, unread } = listMailInput.parse(args);
        return JSON.stringify(
          await client.listMail(accountId, {
            folder: folder ?? 'INBOX',
            limit: limit ?? 20,
            query,
            unread,
          }),
        );
      },
    },
    {
      name: 'get_mail',
      description: '메일 메시지 단건 상세(본문 포함)를 JSON 으로 반환합니다.',
      inputSchema: getMailInput,
      async handler(args) {
        const { messageId } = getMailInput.parse(args);
        return JSON.stringify(await client.getMail(messageId));
      },
    },
  ];
}
