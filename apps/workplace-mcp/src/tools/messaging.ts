// src/tools/messaging.ts — 메시징 도메인 도구. 채널 목록/메시지 조회는 읽기, 메시지 작성만 쓰기다
// (채널/DM 생성·초대 등은 범위 밖 — 기존 채널에 메시지를 남기는 최소 동작만 제공).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 메시징 도메인 도구 3종(list_channels/get_channel_messages/add_channel_message) 을 구성한다. */
export function buildMessagingTools(client: PatApiClient): McpTool[] {
  const listChannelsInput = z.object({});
  const getChannelMessagesInput = z.object({
    channelId: z.number().int(),
    limit: z.number().int().min(1).max(200).optional(),
  });
  const addChannelMessageInput = z.object({
    channelId: z.number().int(),
    body: z.string().min(1),
  });

  return [
    {
      name: 'list_channels',
      description: '내가 속한 채널/DM 목록을 JSON 으로 반환합니다.',
      inputSchema: listChannelsInput,
      async handler() {
        return JSON.stringify(await client.listChannels());
      },
    },
    {
      name: 'get_channel_messages',
      description: '채널의 최근 메시지 목록을 JSON 으로 반환합니다. limit 기본값 30.',
      inputSchema: getChannelMessagesInput,
      async handler(args) {
        const { channelId, limit } = getChannelMessagesInput.parse(args);
        return JSON.stringify(await client.getChannelMessages(channelId, limit ?? 30));
      },
    },
    {
      name: 'add_channel_message',
      description: '채널에 메시지를 작성합니다.',
      inputSchema: addChannelMessageInput,
      async handler(args) {
        const { channelId, body } = addChannelMessageInput.parse(args);
        await client.addChannelMessage(channelId, body);
        return 'ok';
      },
    },
  ];
}
