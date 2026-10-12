// src/messaging-tools.ts — 메시징 도구 + 멘션 변환. 두 앱 공유(#846, #850, #855).
// 채널 초대(add_channel_member, WP-349)는 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_add_channel_member
// 확인 카드로 한다(경로마다 도구 하나 — ai-agent 프로필에는 싣지 않는다). 두 경로가 입력 스키마(addChannelMemberInput)와 대상 해석
// (requireActiveMember)을 같이 쓴다. 비공개 채널 나가기는 계속 확인 카드(propose_leave_channel)만 한다.
import { z } from 'zod';
import { cursorPageView, dropEmpty } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import { findMemberByUsername, requireActiveMember, searchMembersByTerm } from './member-tools.js';
import type { MemberRow, MemberToolClient, MessagingToolClient } from './tool-client.js';

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

export const listChannelMessagesInput = z.object({
  channelId: z.number().int().positive(),
  // 서버(MessageRepository.MAX_LIMIT)가 100 으로 자른다 — 그 이상을 받는 것처럼 보이지 않게 맞춘다.
  limit: z.number().int().min(1).max(100).default(50),
  // WP-352: 이전 호출이 돌려준 nextCursor 를 그대로 넘기면 한 페이지 더 오래된 메시지다(서버 MessageController 의 cursor).
  cursor: z.string().optional().describe('더 오래된 메시지 커서 — 이전 호출 결과의 nextCursor 를 그대로'),
});
export const getThreadRepliesInput = z.object({ messageId: z.number().int().positive() });
export const discoverChannelsInput = z.object({ q: z.string().min(1) });

/** 서버 스레드 페이지 상한(MessageRepository.MAX_LIMIT). */
const THREAD_PAGE_SIZE = 100;
/** 한 번 호출로 모을 답글 상한 — 넘으면 truncated 로 알린다(비정상적으로 긴 스레드의 토큰 폭주 방지). */
const MAX_THREAD_REPLIES = 500;

/**
 * 답글 행 → LLM 뷰. 스레드 안에서는 모든 행이 같은 값(channelId·parentMessageId)이거나 답글에는 의미 없는 값
 * (replyCount·unreadReplyCount·followed)이라 지우고, 작성자는 이름으로만 둔다(#833). 삭제되지 않은 행의 deleted:false,
 * null·빈 배열도 지운다 — 긴 스레드는 행 수가 많아 반복 필드가 토큰의 대부분을 차지한다.
 */
export function toThreadReplyView({
  channelId: _channelId,
  parentMessageId: _parentMessageId,
  replyCount: _replyCount,
  unreadReplyCount: _unreadReplyCount,
  followed: _followed,
  authorId: _authorId,
  deleted,
  ...rest
}: Record<string, unknown>) {
  return dropEmpty({ ...rest, ...(deleted ? { deleted } : {}) });
}

/**
 * 스레드 답글 전체를 오래된 순으로 모은다. 페이지 넘기기를 LLM 에 맡기면 건너뛰고 잘린 스레드를 요약하므로 핸들러가 끝까지 읽는다.
 */
async function collectThreadReplies(client: MessagingToolClient, messageId: number) {
  const items: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await client.getThreadReplies(messageId, { limit: THREAD_PAGE_SIZE, cursor });
    items.push(...page.items);
    if (!page.hasMore || !page.nextCursor) return { items, truncated: false };
    if (items.length >= MAX_THREAD_REPLIES) return { items, truncated: true };
    cursor = page.nextCursor;
  }
}
export const addChannelMessageInput = z.object({
  channelId: z.number().int().positive(),
  body: z.string().min(1),
});

export const createChannelInput = z.object({
  name: z.string().trim().min(1).max(80),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});
// 본인은 서버가 자동 포함한다. 본인 포함 최대 8명(서버 MAX_MEMBERS).
export const openDmInput = z.object({ usernames: z.array(z.string().min(1)).min(1).max(7) });
export const leaveChannelInput = z.object({ channelId: z.number().int().positive() });
/** 채널 초대 입력(WP-349) — add_channel_member 와 확인 카드 propose_add_channel_member(이 스키마 + summary)가 같이 쓴다. */
export const addChannelMemberInput = z.object({
  channelId: z.number().int().positive(),
  username: z.string().min(1),
});

/** DM 응답 → LLM 뷰. 채팅 도구가 channelId 로 가리키므로 id 를 그 이름으로 주고, 참여자는 이름만 둔다(#833). */
function toDmView(dm: { id: number; participants?: { name: string }[] }) {
  return { channelId: dm.id, participants: (dm.participants ?? []).map((p) => p.name) };
}

export interface MessagingToolOptions {
  /** 이 채널에 쓸 때 답을 달 스레드 parent. ai-agent 가 스레드 안에서 호출됐을 때만 값을 준다(그 외 인라인). */
  parentMessageIdFor?(channelId: number): number | undefined;
}

/** 메시징 도구(list_channels/list_channel_messages/list_thread_replies/add_channel_message/create_channel/open_dm/leave_channel/add_channel_member). */
export function buildMessagingTools(
  client: MessagingToolClient & Pick<MemberToolClient, 'searchMembers'>,
  opts: MessagingToolOptions = {},
): SharedTool[] {
  return [
    {
      name: 'list_channels',
      app: 'messaging',
      kind: 'read',
      description:
        '내가 속한 채널·DM 목록을 JSON 배열로 반환합니다(id·name·kind·visibility 포함). 채널 이름만 알 때 channelId 를 확보한 뒤 list_channel_messages / add_channel_message 에 사용하세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listChannels());
      },
    },
    {
      name: 'discover_channels',
      app: 'messaging',
      kind: 'read',
      description:
        '공개 채널을 이름·키워드로 검색해 JSON 배열로 반환합니다(id·name·kind 포함). list_channels 에 없는 공개 채널을 찾아 channelId 를 확보한 뒤 메시지 조회/작성에 사용하세요.',
      inputSchema: discoverChannelsInput,
      async handler(args) {
        const { q } = discoverChannelsInput.parse(args);
        return JSON.stringify(await client.discoverChannels(q));
      },
    },
    {
      name: 'list_channel_messages',
      app: 'messaging',
      kind: 'read',
      description:
        '채널/DM 의 메시지를 최신순(최신 → 오래된 순)으로 JSON({items, hasMore?, nextCursor?})으로 반환합니다(대화 흐름 확인용). 스레드 답글은 빠지고 최상위 메시지만 담기며, ' +
        '답글이 있으면 replyCount 로 알 수 있습니다(list_thread_replies 로 조회). limit 기본 50·최대 100 이고, 더 오래된 메시지가 있으면 hasMore:true 와 ' +
        'nextCursor 가 옵니다 — nextCursor 를 cursor 로 넘겨 이어 조회하거나, 이어 조회하지 않고 답한다면 최근 일부만 본 것이라고 밝히세요(요약·집계를 전체인 양 하지 마세요). ' +
        'hasMore 가 있어도 다음 페이지가 비어 있을 수 있고, 이 키들이 없으면 채널의 처음까지 다 담긴 것입니다. 삭제된 메시지는 본문이 "(삭제됨)" 으로 옵니다.',
      inputSchema: listChannelMessagesInput,
      async handler(args) {
        const { channelId, limit, cursor } = listChannelMessagesInput.parse(args);
        const page = await client.listChannelMessages(channelId, { limit, cursor });
        return JSON.stringify(cursorPageView(page.items, page));
      },
    },
    {
      name: 'list_thread_replies',
      app: 'messaging',
      kind: 'read',
      description:
        '채널 메시지 하나에 달린 스레드 답글 전체를 오래된 순으로 JSON({items, truncated})으로 반환합니다(스레드 요약·확인용). ' +
        'messageId 는 list_channel_messages 결과에서 replyCount 가 1 이상인 메시지의 id 입니다. ' +
        'truncated 가 true 면 답글이 500개를 넘어 앞부분 500개만 담긴 것이니, 요약할 때 뒷부분이 빠졌다고 밝히세요.',
      inputSchema: getThreadRepliesInput,
      async handler(args) {
        const { messageId } = getThreadRepliesInput.parse(args);
        const { items, truncated } = await collectThreadReplies(client, messageId);
        return JSON.stringify({ items: items.map(toThreadReplyView), truncated });
      },
    },
    {
      name: 'add_channel_message',
      app: 'messaging',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
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
    {
      name: 'create_channel',
      app: 'messaging',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        '새 채널을 만들고 내가 OWNER 가 됩니다. visibility 기본 PUBLIC(누구나 참여), PRIVATE 는 초대받은 사람만 봅니다. ' +
        '이름이 이미 있으면 충돌 오류가 납니다. 만든 채널(id·name·visibility)을 JSON 으로 반환합니다.',
      inputSchema: createChannelInput,
      async handler(args) {
        return JSON.stringify(await client.createChannel(createChannelInput.parse(args)));
      },
    },
    {
      name: 'open_dm',
      app: 'messaging',
      kind: 'write',
      // 같은 참여자 DM 이 있으면 그것을 돌려준다(find-or-create) — 추가만 하고 멱등.
      hints: { destructive: false, idempotent: true },
      description:
        'username 목록의 사람들과의 DM 을 엽니다(나는 자동 포함, 나 포함 최대 8명). 같은 참여자 DM 이 이미 있으면 그것을 돌려줍니다. ' +
        '결과 { channelId, participants } 의 channelId 로 add_channel_message 를 호출하세요. username 은 search_members 로 확인합니다.',
      inputSchema: openDmInput,
      async handler(args) {
        const { usernames } = openDmInput.parse(args);
        const found = await Promise.all(usernames.map((u) => findMemberByUsername(client, u)));
        // 비활성(퇴사) 계정은 대화할 수 없으므로 없는 사람과 같이 거절한다.
        const members = found.filter((m): m is MemberRow => m !== undefined && m.active !== false);
        if (members.length < usernames.length) {
          const ok = new Set(members.map((m) => m.username));
          throw new Error(
            `활성 구성원이 아닌 username: ${usernames.filter((u) => !ok.has(u)).join(', ')}. search_members 로 정확한 username 을 확인하세요.`,
          );
        }
        return JSON.stringify(toDmView(await client.openDm(members.map((m) => m.userId))));
      },
    },
    {
      name: 'leave_channel',
      app: 'messaging',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        '공개 채널에서 나갑니다. 나가면 그 채널의 메시지를 읽거나 쓸 수 없고, 이 도구 묶음에는 다시 참여시키는 도구가 없어 ' +
        '되돌리려면 사용자가 직접 참여해야 합니다(공개 채널이라 가능). 비공개 채널은 나가면 스스로 돌아올 수 없어 이 도구로 나갈 수 없습니다 — ' +
        'propose_leave_channel 도구가 있으면 그것으로 확인 카드를 제안하고, 없으면 사용자가 직접 나가도록 안내하세요. ' +
        '채널 OWNER 는 소유권을 넘기기 전에는 나갈 수 없습니다.',
      inputSchema: leaveChannelInput,
      async handler(args) {
        const { channelId } = leaveChannelInput.parse(args);
        // 비공개 채널 나가기는 사실상 되돌릴 수 없다(join 이 PRIVATE 를 403). 확인 없이 실행되는 도구라 여기서 막고 확인 카드(#860)로 보낸다.
        const channel = await client.getChannel(channelId);
        if (channel.visibility !== 'PUBLIC') {
          throw new Error(
            `'${channel.name ?? channelId}' 은(는) 공개 채널이 아니어서 바로 나갈 수 없습니다. 나가면 다시 참여할 수 없으니 ` +
              'propose_leave_channel 로 확인 카드를 제안하거나(도구가 있을 때) 사용자가 직접 나가도록 안내하세요.',
          );
        }
        await client.leaveChannel(channelId);
        return 'ok';
      },
    },
    {
      name: 'add_channel_member',
      app: 'messaging',
      kind: 'write',
      // 멤버를 추가만 한다. 서버가 이미 멤버면 아무것도 바꾸지 않고 성공한다(ChannelMemberRepository.add 의 ON CONFLICT DO NOTHING,
      // 기존 역할 유지)라 다시 불러도 같은 결과 — 멱등. 확인 카드 사전검증(validateAdd)만 "이미 멤버" 를 거절하는데, 효과 없는 카드를
      // 만들지 않으려는 것이고 직접 실행에는 해당하지 않는다(알림처럼 되풀이되는 부작용이 없다). 워크스페이스 밖에 닿지 않는다.
      hints: { destructive: false, idempotent: true },
      description:
        '채널에 구성원을 초대합니다(MEMBER 로 추가). 채널 OWNER/ADMIN 만 초대할 수 있고 DM 에는 초대할 수 없습니다. ' +
        'channelId 는 list_channels 결과의 id, username 은 search_members 결과의 값입니다(활성 구성원만). 이미 멤버면 역할을 그대로 두고 성공합니다. ' +
        '초대된 사람에게 인박스·푸시 알림은 가지 않고, 그 사람의 채널 목록에 바로 나타납니다. 채널에 연결된 드라이브 공간이 있으면 그 공간 멤버로도 추가됩니다. ' +
        '결과는 { channelId, member: { username, name } } 입니다. 멤버 제거·역할 변경은 이 도구로 하지 않습니다.',
      inputSchema: addChannelMemberInput,
      async handler(args) {
        const { channelId, username } = addChannelMemberInput.parse(args);
        // 확인 카드(propose_add_channel_member)와 같은 대상 판정·문구 — 서버는 비활성 계정을 막지 않으므로 여기서 거른다.
        const target = await requireActiveMember(client, username);
        if ('error' in target) throw new Error(target.error);
        await client.addChannelMember(channelId, target.member.userId);
        return JSON.stringify({ channelId, member: { username: target.member.username, name: target.member.name } });
      },
    },
  ];
}
