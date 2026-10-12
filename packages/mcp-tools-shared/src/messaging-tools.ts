// src/messaging-tools.ts — 메시징 도구 + 멘션 변환. 두 앱 공유(#846, #850, #855).
// 채널 초대(add_channel_member, WP-349)는 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_add_channel_member
// 확인 카드로 한다(경로마다 도구 하나 — ai-agent 프로필에는 싣지 않는다). 두 경로가 입력 스키마(addChannelMemberInput)와 대상 해석
// (requireActiveMember)을 같이 쓴다. 비공개 채널 나가기는 계속 확인 카드(propose_leave_channel)만 한다.
import { z } from 'zod';
import { cursorPageView, dropEmpty, omitKeys, truncatedView } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import { findMemberByUsername, requireActiveMember, searchMembersByTerm } from './member-tools.js';
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
  cursor: z.string().optional().describe('더 오래된 메시지 커서 — 이전 호출 결과의 nextCursor 를 그대로'),
});
/**
 * 내 채널 목록 입력(WP-352). 서버는 내 채널 전체를 한 번에 주므로(페이지 없음 — 웹 사이드바가 전체를 쓴다) 도구가 한 번에 보여 줄 수를
 * 정하고, offset 으로 이어 읽는다(이름순이라 두 호출 사이에 채널이 늘지 않는 한 안정적).
 */
export const listChannelsInput = z.object({
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0).describe('건너뛸 채널 수 — 이전 호출 결과의 nextOffset 을 그대로'),
});
export const getThreadRepliesInput = z.object({ messageId: z.number().int().positive() });
export const discoverChannelsInput = z.object({ q: z.string().min(1) });

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

/** 리액션 집계 [{emoji,count,reacted}] → { "👍": 2 }. 누른 사람 목록은 서버에도 없고, reacted(내가 눌렀나)는 읽기 맥락에서 쓸모가 적다. */
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
        '내가 속한 채널·DM 목록을 JSON({items, total, hasMore?, nextOffset?})으로 반환합니다(items 는 channelId·name·kind·visibility·memberCount·lastMessage 미리보기 포함, 이름순). ' +
        '안 읽은 메시지가 있는 채널만 unreadCount(안 읽은 수)·hasUnreadThreads 가 오고, 없으면 이 키들이 생략됩니다(0 / false). ' +
        '채널 이름만 알 때 channelId 를 확보한 뒤 list_channel_messages / add_channel_message 에 사용하세요. ' +
        'total 은 내 채널 전체 수이고 한 번에 limit 개(기본 100, 최대 200)만 담기므로, 더 있으면 hasMore:true 와 nextOffset 이 옵니다 — ' +
        'nextOffset 을 offset 으로 넘겨 이어 조회하거나, 이어 조회하지 않고 답한다면 일부만 본 것이라고 밝히세요(목록에 없다는 단정·개수 집계 금지). ' +
        '이 키들이 없으면 전부 담긴 것입니다.',
      inputSchema: listChannelsInput,
      async handler(args) {
        const { limit, offset } = listChannelsInput.parse(args);
        const all = (await client.listChannels()) as unknown[];
        const items = all.slice(offset, offset + limit).map((c) => toChannelView(c as Raw));
        const next = offset + items.length;
        return JSON.stringify({ items, total: all.length, ...(next < all.length && { hasMore: true, nextOffset: next }) });
      },
    },
    {
      name: 'discover_channels',
      app: 'messaging',
      kind: 'read',
      description:
        '공개 채널을 이름·키워드로 검색해 JSON 배열로 반환합니다(channelId·name·kind 포함). list_channels 에 없는 공개 채널을 찾아 channelId 를 확보한 뒤 메시지 조회/작성에 사용하세요.',
      inputSchema: discoverChannelsInput,
      async handler(args) {
        const { q } = discoverChannelsInput.parse(args);
        return JSON.stringify((await client.discoverChannels(q)).map((c) => toChannelView(c as Raw)));
      },
    },
    {
      name: 'list_channel_messages',
      app: 'messaging',
      kind: 'read',
      description:
        '채널/DM 의 메시지를 최신순(최신 → 오래된 순)으로 JSON({items, hasMore?, nextCursor?})으로 반환합니다(대화 흐름 확인용). 스레드 답글은 빠지고 최상위 메시지만 담기며, ' +
        '답글이 있는 메시지에만 replyCount 가 옵니다(list_thread_replies 로 조회). 작성자는 authorName·authorKind, 리액션은 { 이모지: 개수 }, ' +
        '본문의 멘션은 "@이름(username)" 으로 풀려 있습니다(풀 수 없는 멘션은 "@(알 수 없는 사용자)"). 값이 없는 키는 생략됩니다. limit 기본 50·최대 100 이고, 더 오래된 메시지가 있으면 hasMore:true 와 ' +
        'nextCursor 가 옵니다 — nextCursor 를 cursor 로 넘겨 이어 조회하거나, 이어 조회하지 않고 답한다면 최근 일부만 본 것이라고 밝히세요(요약·집계를 전체인 양 하지 마세요). ' +
        '이 키들이 없으면 채널의 처음까지 다 담긴 것입니다. 삭제된 메시지는 본문이 "(삭제됨)" 으로 옵니다.',
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
        '채널 메시지 하나에 달린 스레드 답글 전체를 오래된 순으로 JSON({items, truncated?})으로 반환합니다(스레드 요약·확인용). ' +
        'messageId 는 list_channel_messages 결과에서 replyCount 가 있는 메시지의 id 입니다. 본문의 멘션은 "@이름(username)" 으로 풀려 있습니다. ' +
        'truncated:true 가 있으면 답글이 500개를 넘어 앞부분 500개만 담긴 것이니, 요약할 때 뒷부분이 빠졌다고 밝히세요.',
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
        '채널/DM 에 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요. ' +
        '사람을 멘션하려면 본문에 `@username` 을 쓰세요(username 은 search_members 결과) — 멘션 알림으로 변환됩니다. 메시지 조회 결과의 "@이름(username)" 표기를 따라 쓰지 말고 `@username` 으로 쓰세요.',
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
        '이름이 이미 있으면 충돌 오류가 납니다. 만든 채널(channelId·name·visibility)을 JSON 으로 반환합니다.',
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
        'channelId 는 list_channels 결과의 channelId, username 은 search_members 결과의 값입니다(활성 구성원만). 이미 멤버면 역할을 그대로 두고 성공합니다. ' +
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
