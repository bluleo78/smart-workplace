// src/messaging-tools.ts — 메시징 도구 + 멘션 변환. 두 앱 공유(#846, #850, #855).
// 채널 초대(add_channel_member, WP-349)는 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_add_channel_member
// 확인 카드로 한다(경로마다 도구 하나 — ai-agent 프로필에는 싣지 않는다). 두 경로가 입력 스키마(addChannelMemberInput)와 대상 해석
// (requireActiveMember)을 같이 쓴다. 비공개 채널 나가기는 계속 확인 카드(propose_leave_channel)만 한다.
// WP-355: 채널 참여(join_channel)·리액션(add_reaction·remove_reaction)·내 메시지 수정(update_channel_message)·채널 읽음 처리(mark_channel_read)를 더했다.
// 메시지 삭제는 되돌릴 수 없어 도구로 두지 않는다(AI Chat 확인 카드도 아직 없음). 채널 멤버 목록은 search_members 의 channelId 옵션(member-tools.ts)이다.
import { z } from 'zod';
import { cursorPageView, dropEmpty, omitKeys, truncatedView } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import { findMemberByUsername, requireActiveMember, searchMembersByTerm } from './member-tools.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { MemberRow, MemberToolClient, MessagingToolClient } from './tool-client.js';

// 줄 시작·공백·여는 괄호 뒤의 @ 만 후보로 보므로 메일 주소(a@b.com)의 @ 는 건드리지 않고,
// 캡처는 마침표로 끝나지 않아 문장 끝 마침표("@kim.")는 원문에 남는다.
// 뒤에 붙은 `(username)` 은 목록 출력의 표기(@이름(username), WP-353)를 그대로 따라 쓴 경우라 선택 캡처한다 — 해석된 멘션의 username 과 같으면 함께 삼킨다.
const MENTION_CANDIDATE = /(^|[\s(])@([\p{L}\p{N}._+@-]*[\p{L}\p{N}_+@-])(?:\(([\p{L}\p{N}._+@-]+)\))?/gu;
// 한국어는 호칭·조사를 이름에 붙여 쓴다("@김철수님", "@kim.cs에게도"). 한 겹씩 벗겨 후보를 만든다.
const MENTION_SUFFIX = /(께서|에게|한테|님|씨|께|이|가|은|는|을|를|의|도)$/u;
// 본문 하나에서 해석할 멘션 수 상한 — 토큰마다 조회 1회라 @ 가 많은 본문의 요청 폭주를 막는다.
const MAX_MENTIONS = 20;

/** 토큰 → 후보 이름들. 긴 것부터(토큰 전체 → 조사를 한 겹씩 뗀 형태). */
function candidateNames(token: string): string[] {
  const names = [token];
  let t = token;
  while ((t = t.replace(MENTION_SUFFIX, '')) && t !== names.at(-1)) names.push(t);
  return names;
}

/**
 * 본문의 `@username` 을 멘션 토큰 `<@userId>` 로 바꾼다(#844). 서버 멘션 파서는 숫자 id 토큰만 인식하는데,
 * LLM 표면은 username 만 다루므로(#833) 변환을 도구가 맡는다. 모델이 조회를 건너뛰고 표시 이름(@김철수)을
 * 쓰는 경우도 있어, username 정확일치가 없으면 표시 이름이 정확히 한 명과 일치할 때만 멘션한다(동명이인은 그대로).
 * 목록 출력의 표기를 따라 `@이름(username)` 으로 쓴 경우에는 괄호 안 username 을 먼저 정확일치로 해석한다(동명이인이어도 username 이 가린다).
 */
export async function linkMentions(client: Pick<MemberToolClient, 'searchMembers'>, body: string): Promise<string> {
  // 같은 (이름, 괄호) 쌍은 한 번만 해석한다 — `@김민수(a)` 와 `@김민수(b)` 는 서로 다른 후보다.
  const keyOf = (raw: string, paren: string | undefined) => `${raw}\u0000${paren ?? ''}`;
  const candidates = new Map<string, { raw: string; paren: string | undefined }>();
  for (const m of body.matchAll(MENTION_CANDIDATE)) candidates.set(keyOf(m[2], m[3]), { raw: m[2], paren: m[3] });
  if (candidates.size === 0) return body;
  // 후보 → 멘션 대상 id + 식별자에 해당하는 앞부분 길이(나머지 조사는 원문 그대로 남긴다).
  const entries = await Promise.all(
    [...candidates].slice(0, MAX_MENTIONS).map(async ([key, { raw: token, paren }]) => {
      // 후보는 긴 것부터(토큰 전체 → 조사를 한 겹씩 뗀 형태). 가장 짧은 후보로 한 번만 검색하면
      // 부분일치라 더 긴 후보도 결과에 포함된다.
      const names = candidateNames(token);
      // 괄호 안 username 이 정확히 일치하면 그 구성원이 답이다 — 이름이 같은 사람이 여럿이어도 가려진다.
      // 이름 부분의 길이는 표시 이름·username 과 맞는 후보를 찾고, 없으면 토큰 전체를 이름으로 본다.
      if (paren) {
        const byParen = (await searchMembersByTerm(client, paren, false).catch(() => [])).find((m) => m.username === paren);
        if (byParen) {
          const length = names.find((n) => n === byParen.name || n === byParen.username)?.length ?? token.length;
          return [key, { id: byParen.userId, username: byParen.username, length }] as const;
        }
      }
      // 조회 실패는 멘션 없이 원문 게시로 강등 — 메시지 작성 자체를 막지 않는다.
      const rows = await searchMembersByTerm(client, names.at(-1)!, false).catch(() => []);
      for (const name of names) {
        const byName = rows.filter((m) => m.name === name);
        const hit = rows.find((m) => m.username === name) ?? (byName.length === 1 ? byName[0] : undefined);
        if (hit) return [key, { id: hit.userId, username: hit.username, length: name.length }] as const;
      }
      return undefined;
    }),
  );
  const resolved = new Map(entries.filter((e) => e !== undefined));
  return body.replace(MENTION_CANDIDATE, (all, lead: string, raw: string, paren: string | undefined) => {
    const hit = resolved.get(keyOf(raw, paren));
    if (!hit) return all;
    // `@김민수(minsu)` 처럼 해석된 username 이 괄호로 따라오면 중복 표기라 지운다(다른 값이면 원문 괄호를 살린다).
    const rest = paren === undefined || paren === hit.username ? '' : `(${paren})`;
    return `${lead}<@${hit.id}>${raw.slice(hit.length)}${rest}`;
  });
}

export const listChannelMessagesInput = z.object({
  channelId: z.number().int().positive(),
  // 서버(MessageRepository.MAX_LIMIT)가 100 으로 자른다 — 그 이상을 받는 것처럼 보이지 않게 맞춘다.
  limit: z.number().int().min(1).max(100).default(50),
  // WP-352: 이전 호출이 돌려준 nextCursor 를 그대로 넘기면 한 페이지 더 오래된 메시지다(서버 MessageController 의 cursor).
  cursor: z.string().optional(),
});
/**
 * 내 채널 목록 입력(WP-352). 서버는 내 채널 전체를 한 번에 주므로(페이지 없음 — 웹 사이드바가 전체를 쓴다) 도구가 한 번에 보여 줄 수를
 * 정하고, offset 으로 이어 읽는다(이름순이라 두 호출 사이에 채널이 늘지 않는 한 안정적).
 */
export const listChannelsInput = z.object({
  // WP-355: discover_channels 를 접었다(메시징 앱 15개 상한) — q 가 있으면 공개 채널 탐색(가입 여부 무관), 없으면 내 채널·DM.
  q: nullAsOmitted(z.string().min(1)),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});
export const getThreadRepliesInput = z.object({ messageId: z.number().int().positive() });

/** 서버 스레드 페이지 상한(MessageRepository.MAX_LIMIT). */
const THREAD_PAGE_SIZE = 100;
/** 한 번 호출로 모을 답글 상한 — 넘으면 truncated 로 알린다(비정상적으로 긴 스레드의 토큰 폭주 방지). */
const MAX_THREAD_REPLIES = 500;

type Raw = Record<string, unknown>;

/** 객체 배열의 각 원소에서 키를 뺀다 — 배열이 아니면(없음·null) 그대로 둔다. */
function omitInEach(list: unknown, ...keys: string[]): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((row) => (row && typeof row === 'object' ? omitKeys(row as Raw, ...keys) : row));
}

/** 서버가 본문에 심는 멘션 토큰 `<@userId>`(MentionParser). */
const MENTION_TOKEN = /<@(\d+)>/g;

/** 풀 수 없는 멘션 토큰(탈퇴·삭제된 사용자 등 mentions 에 없는 id)을 대신하는 표기 — 숫자 id 를 그대로 흘리지 않는다. */
const UNKNOWN_MENTION = '@(알 수 없는 사용자)';

/**
 * 본문의 멘션 토큰 `<@123>` 을 `@이름(username)` 으로 바꾼다(#833, WP-353). 서버가 같이 주는 mentions(id·username·name)를 사전으로 쓰므로
 * 추가 조회가 없다. mentions 에 없는 id 는 숫자를 노출하지 않도록 UNKNOWN_MENTION 으로 바꾼다. 이름·username 중 하나만 있으면 있는 쪽만 쓴다.
 * 쓰기 쪽(add_channel_message 의 linkMentions)은 모델이 이 표기를 흉내 내 `@이름(username)` 으로 써도(공백 없는 이름) 같은 멘션으로 읽는다 — 안내는 `@username`.
 */
export function resolveMentionTokens(body: string, mentions: unknown): string {
  const byId = new Map<string, { username?: string; name?: string }>();
  if (Array.isArray(mentions)) {
    for (const m of mentions as Raw[]) {
      if (m && m.id != null) {
        byId.set(String(m.id), {
          username: typeof m.username === 'string' && m.username ? m.username : undefined,
          name: typeof m.name === 'string' && m.name ? m.name : undefined,
        });
      }
    }
  }
  return body.replace(MENTION_TOKEN, (_all, id: string) => {
    const m = byId.get(id);
    if (!m || (!m.name && !m.username)) return UNKNOWN_MENTION;
    if (m.name && m.username) return `@${m.name}(${m.username})`;
    return `@${m.name ?? m.username}`;
  });
}

/**
 * 메시지 행의 숫자 사용자 ID 를 걷어낸다(#833, WP-353). 작성자는 authorName(표시 이름)만 남기고 authorId 를 뺀다(답글 뷰의 기존 방식) —
 * 서버 메시지 응답에 username 은 없고 authorKind(HUMAN/AGENT)와 이름뿐이라, 이름으로 사람을 가리키려는 용도로는 이것으로 충분하다.
 * 같은 이유로 첨부자(attachedById)·드라이브 링크 생성자(createdById)·제안 작성자(proposedByUserId)·제안 참석자(userId)도 뺀다.
 * 드라이브 링크의 core fileId 는 driveFileId 와 겹쳐 혼동을 부르므로 함께 뺀다(#840 과 같은 이유).
 * 멘션(mentions[].id)은 toMessageView 가 본문 토큰을 이름으로 푼 뒤 뺀다 — 여기서는 건드리지 않는다.
 */
export function stripMessageUserIds({ authorId: _authorId, ...rest }: Raw): Raw {
  const out: Raw = { ...rest };
  if ('attachments' in out) out.attachments = omitInEach(out.attachments, 'attachedById');
  if ('driveLinks' in out) out.driveLinks = omitInEach(out.driveLinks, 'createdById', 'fileId');
  const proposal = out.proposal as Raw | null | undefined;
  if (proposal && typeof proposal === 'object') {
    const { proposedByUserId: _proposedBy, ...p } = proposal;
    out.proposal = 'attendees' in p ? { ...p, attendees: omitInEach(p.attendees, 'userId') } : p;
  }
  return out;
}

/** 리액션 집계 [{emoji,count,reacted}] → { "👍": 2 }. 누른 사람 목록은 서버에 GET /api/v1/messaging/messages/{id}/reactions/users(WP-106)로 따로 있지만 메시지 목록 응답에는 없고 도구 뷰도 개수만 둔다. reacted(내가 눌렀나)는 읽기 맥락에서 쓸모가 적다. */
function reactionSummary(reactions: unknown): Record<string, number> | undefined {
  if (!Array.isArray(reactions) || reactions.length === 0) return undefined;
  const entries = (reactions as Raw[]).filter((r) => typeof r.emoji === 'string').map((r) => [r.emoji as string, Number(r.count ?? 0)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * 메시지 행(MessageResponse) → LLM 뷰(WP-353). 사용자 ID 를 걷어내고(stripMessageUserIds) 본문 멘션 토큰을 이름으로 풀며 mentions 에서 id 를 뺀다.
 * 반복·노이즈 필드를 줄인다 — channelId(요청 인자와 같음)·parentMessageId(최상위는 null)·삭제 아님(deleted:false)·값 없는 키,
 * 리액션은 { emoji: 개수 } 요약, 첨부는 파일 식별·이름·종류·크기만(첨부자·시각·messageId 는 메시지와 중복), 드라이브 링크는 썸네일 여부·생성 시각 제외,
 * 제안 카드는 비어 있는 필드와 카드 자신의 id 제외.
 * thread=true 는 답글 행(list_thread_replies) — 스레드 안에서 전부 같은 값이거나 답글에 의미 없는 replyCount·unreadReplyCount·followed 도 뺀다.
 * 최상위 행은 그 값들이 0·false 가 아닐 때만 남긴다(replyCount 가 있으면 list_thread_replies 로 이어 읽는다).
 */
export function toMessageView(row: Raw, thread = false): Raw {
  const {
    channelId: _channelId,
    parentMessageId: _parentMessageId,
    replyCount,
    unreadReplyCount,
    followed,
    deleted,
    reactions,
    mentions,
    body,
    attachments,
    driveLinks,
    proposal,
    ...rest
  } = stripMessageUserIds(row);
  const people = Array.isArray(mentions) ? (mentions as Raw[]).map((m) => omitKeys(m, 'id')) : undefined;
  return dropEmpty({
    ...rest,
    ...(typeof body === 'string' ? { body: resolveMentionTokens(body, mentions) } : { body }),
    mentions: people,
    reactions: reactionSummary(reactions),
    attachments: Array.isArray(attachments)
      ? (attachments as Raw[]).map((a) => dropEmpty(omitKeys(a, 'messageId', 'attachedById', 'attachedByName', 'attachedAt')))
      : attachments,
    driveLinks: Array.isArray(driveLinks) ? (driveLinks as Raw[]).map((l) => dropEmpty(omitKeys(l, 'hasThumbnail', 'createdAt'))) : driveLinks,
    proposal: proposal && typeof proposal === 'object' ? dropEmpty(omitKeys(proposal as Raw, 'id')) : proposal,
    ...(deleted ? { deleted } : {}),
    ...(!thread && Number(replyCount) > 0 && { replyCount }),
    ...(!thread && Number(unreadReplyCount) > 0 && { unreadReplyCount }),
    ...(!thread && followed === true && { followed }),
  });
}

/**
 * 채널 행(ChannelResponse) → LLM 뷰. 공용 `id` 를 channelId 로 바꾸고(채널 도구의 입력 이름과 같게, #833·WP-353),
 * 마지막 메시지 미리보기(lastMessage)의 숫자 authorId 는 뺀다(authorName 은 둔다).
 * WP-353 정리: 읽음 워터마크(lastReadMessageId — 메시지 id 를 읽는 도구가 없다)와 값이 없는 키를 빼고, 0·false 인 unreadCount·
 * hasUnreadThreads·archived 도 생략한다(키가 없으면 0·false). member 는 탐색 결과에서 가입 여부를 가르므로 그대로 둔다.
 */
export function toChannelView({ id, lastMessage, lastReadMessageId: _lastRead, unreadCount, hasUnreadThreads, archived, ...rest }: Raw): Raw {
  const preview = lastMessage && typeof lastMessage === 'object' ? omitKeys(lastMessage as Raw, 'authorId') : lastMessage;
  return dropEmpty({
    channelId: id,
    ...rest,
    ...(Number(unreadCount) > 0 && { unreadCount }),
    ...(hasUnreadThreads === true && { hasUnreadThreads }),
    ...(archived === true && { archived }),
    lastMessage: preview,
  });
}

/**
 * 답글 행 → LLM 뷰. 스레드 안에서는 모든 행이 같은 값(channelId·parentMessageId)이거나 답글에는 의미 없는 값
 * (replyCount·unreadReplyCount·followed)이라 지우고, 작성자는 이름으로만 둔다(#833). 삭제되지 않은 행의 deleted:false,
 * null·빈 배열도 지운다 — 긴 스레드는 행 수가 많아 반복 필드가 토큰의 대부분을 차지한다. 본문 멘션은 이름으로 푼다(WP-353).
 */
export function toThreadReplyView(row: Raw): Raw {
  return toMessageView(row, true);
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
/** 채널 참여·읽음 처리 입력(WP-355) — 둘 다 channelId 하나다. */
export const joinChannelInput = z.object({ channelId: z.number().int().positive() });
export const markChannelReadInput = joinChannelInput;
/**
 * 리액션 추가·제거 입력(WP-355). 서버는 이모지를 1~32자 문자열로만 검사하고(ReactionRequest) 웹 선택기는 유니코드 문자를 보낸다.
 * 제거는 추가한 것과 같은 문자열이어야 한다 — 읽기 출력 reactions 의 키 그대로다. messageId 는 메시지 행의 id 다(출력 이름은 id).
 */
const messageIdField = z.number().int().positive().describe('from list_channel_messages or list_thread_replies');
export const reactionInput = z.object({
  messageId: messageIdField,
  emoji: z.string().min(1).max(32).describe('Unicode emoji such as 👍'),
});
/** 내 메시지 수정 입력(WP-355) — 서버 UpdateMessageRequest 와 같은 1~4000자. */
export const updateChannelMessageInput = z.object({
  messageId: messageIdField,
  body: z.string().min(1).max(4000),
});
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

/** 메시징 도구(list_channels/list_channel_messages/list_thread_replies/add_channel_message/create_channel/open_dm/leave_channel/join_channel/add_reaction/remove_reaction/update_channel_message/mark_channel_read/add_channel_member). */
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
        'Lists my channels and DMs (채널·DM) by name as {items, total, hasMore?, nextOffset?}: channelId, kind, lastMessage, memberCount; unreadCount ' +
        'and hasUnreadThreads only when set. q: search public channels by name substring instead, joined or not (member); join_channel to read or ' +
        'post. If hasMore, pass nextOffset as offset, or say the list is partial.',
      inputSchema: listChannelsInput,
      async handler(args) {
        const { q, limit, offset } = listChannelsInput.parse(args);
        // q 가 있으면 공개 채널 탐색(구 discover_channels), 없으면 내 채널 — 둘 다 서버가 전체를 주므로 같은 방식으로 잘라 이어 읽는다.
        const all = q != null ? await client.discoverChannels(q) : ((await client.listChannels()) as unknown[]);
        const items = all.slice(offset, offset + limit).map((c) => toChannelView(c as Raw));
        const next = offset + items.length;
        return JSON.stringify({ items, total: all.length, ...(next < all.length && { hasMore: true, nextOffset: next }) });
      },
    },
    {
      name: 'list_channel_messages',
      app: 'messaging',
      kind: 'read',
      description:
        'Lists top-level messages of a channel or DM I belong to, newest first, as {items, hasMore?, nextCursor?}. Replies are left out; ' +
        'messages with replies carry replyCount (see list_thread_replies). Markdown body, mentions as "@name(username)", reactions {emoji: ' +
        'count}; deleted ones read "(삭제됨)". If hasMore, pass nextCursor as cursor for older messages, or say the list is partial.',
      inputSchema: listChannelMessagesInput,
      async handler(args) {
        const { channelId, limit, cursor } = listChannelMessagesInput.parse(args);
        const page = await client.listChannelMessages(channelId, { limit, cursor });
        return JSON.stringify(cursorPageView((page.items as Raw[]).map((m) => toMessageView(m)), page));
      },
    },
    {
      name: 'list_thread_replies',
      app: 'messaging',
      kind: 'read',
      description:
        'Returns all replies in the thread of a channel message, oldest first, as {items, truncated?}. messageId: id of a list_channel_messages ' +
        'item with replyCount. Mentions read "@name(username)". truncated:true means only the first 500 replies are included: say the rest is ' +
        'missing.',
      inputSchema: getThreadRepliesInput,
      async handler(args) {
        const { messageId } = getThreadRepliesInput.parse(args);
        const { items, truncated } = await collectThreadReplies(client, messageId);
        return JSON.stringify(truncatedView(items.map(toThreadReplyView), truncated));
      },
    },
    {
      name: 'add_channel_message',
      app: 'messaging',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Posts a Markdown message to a channel or DM I belong to; call it once. Mention with @username (from search_members), not the ' +
        '"@name(username)" form shown when reading. Mentioned people and DM members get a push notification.',
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
        'Creates a channel (채널) with me as OWNER. visibility PUBLIC (default, anyone can join) or PRIVATE (invited people only). A name in use ' +
        'is a conflict.',
      inputSchema: createChannelInput,
      async handler(args) {
        return JSON.stringify(toChannelView((await client.createChannel(createChannelInput.parse(args))) as Raw));
      },
    },
    {
      name: 'open_dm',
      app: 'messaging',
      kind: 'write',
      // 같은 참여자 DM 이 있으면 그것을 돌려준다(find-or-create) — 추가만 하고 멱등.
      hints: { destructive: false, idempotent: true },
      description:
        'Opens a DM with up to 7 active members by username (from search_members); I am included, and an existing DM with the same people is ' +
        'reused. Returns {channelId, participants}; post with add_channel_message.',
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
        'Leaves a public channel (join_channel rejoins). Private channels are refused as irreversible: ' +
        'offer propose_leave_channel if available, else ask the user.',
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
      name: 'join_channel',
      app: 'messaging',
      kind: 'write',
      // 이미 멤버면 아무것도 바꾸지 않고 성공한다(ChannelMemberRepository.add 의 ON CONFLICT DO NOTHING) — 멱등. 알림은 없고 목록 갱신 신호뿐이다.
      hints: { destructive: false, idempotent: true },
      description:
        'Joins a public channel (채널) as MEMBER (channelId from list_channels with q); DMs and non-public channels are refused. Earlier messages do not ' +
        'count as unread.',
      inputSchema: joinChannelInput,
      async handler(args) {
        await client.joinChannel(joinChannelInput.parse(args).channelId);
        return 'ok';
      },
    },
    {
      name: 'add_reaction',
      app: 'messaging',
      kind: 'write',
      // 서버가 이미 있는 리액션은 이벤트 없이 무시한다(ReactionService.add) — 멱등. 누른 사람에게 알림은 가지 않는다.
      hints: { destructive: false, idempotent: true },
      description: 'Adds my emoji reaction to a message in a channel or DM I belong to; repeating is a no-op.',
      inputSchema: reactionInput,
      async handler(args) {
        const { messageId, emoji } = reactionInput.parse(args);
        await client.addReaction(messageId, emoji);
        return 'ok';
      },
    },
    {
      name: 'remove_reaction',
      app: 'messaging',
      kind: 'write',
      // 제거는 destructive(README 노출 기준) — 없던 리액션을 지워도 오류 없이 같은 결과(ReactionService.remove)라 멱등이다.
      hints: { destructive: true, idempotent: true },
      description: 'Removes my own emoji reaction from a message; no-op if absent.',
      inputSchema: reactionInput,
      async handler(args) {
        const { messageId, emoji } = reactionInput.parse(args);
        await client.removeReaction(messageId, emoji);
        return 'ok';
      },
    },
    {
      name: 'update_channel_message',
      app: 'messaging',
      kind: 'write',
      // 본문을 덮어쓴다(이전 본문은 남지 않는다)라 destructive. 같은 본문으로 다시 불러도 저장 내용은 같고 알림이 없다(MessageUpdatedEvent 는 SSE 만) — 멱등.
      hints: { destructive: true, idempotent: true },
      description:
        'Replaces the body of my own message (any age, replies too) with new Markdown; it shows as edited and the old text is lost. Mention with ' +
        '@username as in add_channel_message; edits send no notification. Returns the saved message.',
      inputSchema: updateChannelMessageInput,
      async handler(args) {
        const { messageId, body } = updateChannelMessageInput.parse(args);
        // 서버가 수정 때 본문의 <@id> 토큰을 다시 해석하므로 작성과 같이 @username 을 토큰으로 바꿔 보낸다 — 안 바꾸면 멘션이 조용히 사라진다.
        const saved = await client.updateChannelMessage(messageId, await linkMentions(client, body));
        // 응답은 서버 MessageResponse 원형(authorId 포함) — 읽기 도구와 같은 뷰로 가공해 숫자 사용자 ID 를 내보내지 않는다.
        return JSON.stringify(toMessageView(saved as Raw, (saved as Raw).parentMessageId != null));
      },
    },
    {
      name: 'mark_channel_read',
      app: 'messaging',
      kind: 'write',
      // 읽음 위치는 GREATEST 로만 올라가 되돌아가지 않는다(ChannelMemberRepository.markRead) — 같은 인자로 다시 불러도 같은 결과(멱등). 안 읽음 표시를 지우므로 destructive.
      hints: { destructive: true, idempotent: true },
      description:
        'Marks a channel or DM I belong to as read up to its newest top-level message (clears unreadCount); thread replies are tracked separately.',
      inputSchema: markChannelReadInput,
      async handler(args) {
        const { channelId } = markChannelReadInput.parse(args);
        // 서버는 "어디까지 읽었나"(uptoMessageId)를 요구한다 — 가장 최근 최상위 메시지의 id 로 채운다(채널 안 읽음 수가 세는 것도 최상위 메시지뿐이다).
        const page = await client.listChannelMessages(channelId, { limit: 1 });
        const newest = (page.items[0] as Raw | undefined)?.id;
        // 메시지가 없는 채널은 읽을 것이 없다 — 서버 호출 없이 성공으로 돌려준다.
        if (typeof newest === 'number') await client.markChannelRead(channelId, newest);
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
        'Invites an active member (username from search_members) to a channel as MEMBER; channel OWNER or ADMIN only, not DMs. Existing members ' +
        'are left as is. Not notified. Also joins the channel drive space, if any.',
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
