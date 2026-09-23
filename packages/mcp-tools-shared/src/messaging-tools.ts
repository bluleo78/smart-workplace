// src/messaging-tools.ts — 메시징 도구 3종 + 멘션 변환. 두 앱 공유(#846).
import { z } from 'zod';
import type { McpTool } from './mcp-tool.js';
import { searchMembersByTerm } from './member-tools.js';
import type { MemberToolClient, MessagingToolClient } from './tool-client.js';

// 줄 시작·공백·여는 괄호 뒤의 @ 만 후보로 보므로 메일 주소(a@b.com)의 @ 는 건드리지 않고,
// 캡처는 마침표로 끝나지 않아 문장 끝 마침표("@kim.")는 원문에 남는다.
const MENTION_CANDIDATE = /(^|[\s(])@([\p{L}\p{N}._+@-]*[\p{L}\p{N}_+@-])/gu;
// 한국어는 호칭·조사를 이름에 붙여 쓴다("@김철수님", "@kim.cs에게도"). 한 겹씩 벗겨 후보를 만든다.
const MENTION_SUFFIX = /(께서|에게|한테|님|씨|께|이|가|은|는|을|를|의|도)$/u;
// 본문 하나에서 해석할 멘션 수 상한 — 토큰마다 조회 1회라 @ 가 많은 본문의 요청 폭주를 막는다.
const MAX_MENTIONS = 20;

/**
 * 본문의 `@username` 을 멘션 토큰 `<@userId>` 로 바꾼다(#844). 서버 멘션 파서는 숫자 id 토큰만 인식하는데,
 * LLM 표면은 username 만 다루므로(#833) 변환을 도구가 맡는다. 모델이 조회를 건너뛰고 표시 이름(@김철수)을
 * 쓰는 경우도 있어, username 정확일치가 없으면 표시 이름이 정확히 한 명과 일치할 때만 멘션한다(동명이인은 그대로).
 */
export async function linkMentions(client: Pick<MemberToolClient, 'searchMembers'>, body: string): Promise<string> {
  const tokens = [...new Set([...body.matchAll(MENTION_CANDIDATE)].map((m) => m[2]))].slice(0, MAX_MENTIONS);
  if (tokens.length === 0) return body;
  // 토큰 → 멘션 대상 id + 식별자에 해당하는 앞부분 길이(나머지 조사는 원문 그대로 남긴다).
  const entries = await Promise.all(
    tokens.map(async (token) => {
      // 후보는 긴 것부터(토큰 전체 → 조사를 한 겹씩 뗀 형태). 가장 짧은 후보로 한 번만 검색하면
      // 부분일치라 더 긴 후보도 결과에 포함된다.
      const names = [token];
      let t = token;
      while ((t = t.replace(MENTION_SUFFIX, '')) && t !== names.at(-1)) names.push(t);
      // 조회 실패는 멘션 없이 원문 게시로 강등 — 메시지 작성 자체를 막지 않는다.
      const rows = await searchMembersByTerm(client, names.at(-1)!, false).catch(() => []);
      for (const name of names) {
        const byName = rows.filter((m) => m.name === name);
        const id = rows.find((m) => m.username === name)?.userId ?? (byName.length === 1 ? byName[0].userId : undefined);
        if (id !== undefined) return [token, { id, length: name.length }] as const;
      }
      return undefined;
    }),
  );
  const resolved = new Map(entries.filter((e) => e !== undefined));
  return body.replace(MENTION_CANDIDATE, (all, lead: string, raw: string) => {
    const hit = resolved.get(raw);
    return hit ? `${lead}<@${hit.id}>${raw.slice(hit.length)}` : all;
  });
}

export const getChannelMessagesInput = z.object({
  channelId: z.number().int().positive(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const addChannelMessageInput = z.object({
  channelId: z.number().int().positive(),
  body: z.string().min(1),
});

export interface MessagingToolOptions {
  /** 이 채널에 쓸 때 답을 달 스레드 parent. ai-agent 가 스레드 안에서 호출됐을 때만 값을 준다(그 외 인라인). */
  parentMessageIdFor?(channelId: number): number | undefined;
}

/** 메시징 도구 3종(list_channels/get_channel_messages/add_channel_message). */
export function buildMessagingTools(
  client: MessagingToolClient & Pick<MemberToolClient, 'searchMembers'>,
  opts: MessagingToolOptions = {},
): McpTool[] {
  return [
    {
      name: 'list_channels',
      description:
        '내가 속한 채널·DM 목록을 JSON 배열로 반환합니다(id·name·kind·visibility 포함). 채널 이름만 알 때 channelId 를 확보한 뒤 get_channel_messages / add_channel_message 에 사용하세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listChannels());
      },
    },
    {
      name: 'get_channel_messages',
      description: '채널/DM 의 최근 메시지 목록을 JSON 으로 반환합니다(대화 흐름 확인용). limit 기본 50.',
      inputSchema: getChannelMessagesInput,
      async handler(args) {
        const { channelId, limit } = getChannelMessagesInput.parse(args);
        return JSON.stringify(await client.getChannelMessages(channelId, limit));
      },
    },
    {
      name: 'add_channel_message',
      description:
        '채널/DM 에 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요. ' +
        '사람을 멘션하려면 본문에 `@username` 을 쓰세요(username 은 search_members 결과) — 멘션 알림으로 변환됩니다.',
      inputSchema: addChannelMessageInput,
      async handler(args) {
        const { channelId, body } = addChannelMessageInput.parse(args);
        await client.addChannelMessage(channelId, await linkMentions(client, body), opts.parentMessageIdFor?.(channelId));
        return 'ok';
      },
    },
  ];
}
