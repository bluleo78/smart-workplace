import { describe, expect, it, vi } from 'vitest';
import { buildMessagingTools, linkMentions, resolveMentionTokens, toChannelView, toMessageView, toThreadReplyView, type MessagingToolOptions } from './messaging-tools.js';
import type { MemberRow, MemberSearchParams, MemberToolClient, MessagingToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

type Client = MessagingToolClient & Pick<MemberToolClient, 'searchMembers'>;

/** 메시징 + 구성원 검색(멘션 변환용) mock. */
function mockClient(): Client {
  return {
    listChannels: vi.fn().mockResolvedValue([]),
    listChannelMessages: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    getThreadReplies: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    searchMembers: vi.fn().mockResolvedValue([]),
    getChannel: vi.fn().mockResolvedValue({ id: 4, name: 'general', visibility: 'PUBLIC' }),
    createChannel: vi.fn().mockResolvedValue({ id: 12, name: 'new', visibility: 'PUBLIC' }),
    openDm: vi.fn().mockResolvedValue({ id: 20, participants: [] }),
    leaveChannel: vi.fn().mockResolvedValue(undefined),
    addChannelMember: vi.fn().mockResolvedValue(undefined),
    discoverChannels: vi.fn().mockResolvedValue([]),
    joinChannel: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    updateChannelMessage: vi.fn().mockResolvedValue({}),
    markChannelRead: vi.fn().mockResolvedValue(undefined),
  };
}

/** 첨부 없는 add_channel_message 호출의 4번째 인자(WP-423) — 빈 첨부는 클라이언트가 요청 본문에 싣지 않는다. */
const NO_ATTACHMENTS = { fileIds: undefined, driveFileIds: undefined };
const tool = (c: Client, name: string, opts?: MessagingToolOptions) =>
  buildMessagingTools(c, opts).find((x) => x.name === name)!;

describe('buildMessagingTools', () => {
  /** 서버 MessageResponse 형태의 답글 행. */
  const reply = (id: number) => ({
    id,
    channelId: 9,
    authorId: 1,
    authorName: '양동희',
    authorKind: 'HUMAN',
    body: `답글 ${id}`,
    mentions: [],
    parentMessageId: 30,
    replyCount: 0,
    reactions: [],
    attachments: [],
    driveLinks: [],
    createdAt: 't',
    editedAt: null,
    deleted: false,
    unreadReplyCount: 0,
    followed: false,
    proposal: null,
  });

  it('list_channels q → client.discoverChannels(q) 결과를 같은 {items,total} 형태로 반환하고 빈 q 는 거절한다 (#350, WP-355)', async () => {
    const c = mockClient();
    vi.mocked(c.discoverChannels).mockResolvedValue([{ id: 3, name: '공지', kind: 'PUBLIC', member: false }]);
    const out = await tool(c, 'list_channels').handler({ q: '공지' });
    expect(c.discoverChannels).toHaveBeenCalledWith('공지');
    expect(c.listChannels).not.toHaveBeenCalled();
    // 채널은 어디서나 channelId 로 가리킨다(WP-353). member 는 가입 여부라 그대로 둔다.
    expect(JSON.parse(resultText(out))).toEqual({ items: [{ channelId: 3, name: '공지', kind: 'PUBLIC', member: false }], total: 1 });
    await expect(tool(c, 'list_channels').handler({ q: '' })).rejects.toThrow();
    // 모델이 쓰지 않는 q 를 null 로 보내도 내 채널 목록으로 본다.
    await tool(c, 'list_channels').handler({ q: null });
    expect(c.listChannels).toHaveBeenCalledTimes(1);
  });

  it('list_channels q → limit·offset 으로 잘라 hasMore·nextOffset 으로 이어 읽는다 (WP-355)', async () => {
    const c = mockClient();
    vi.mocked(c.discoverChannels).mockResolvedValue([1, 2, 3].map((id) => ({ id, name: `c${id}`, kind: 'PUBLIC', member: false })));
    const first = JSON.parse(resultText(await tool(c, 'list_channels').handler({ q: 'c', limit: 2 })));
    expect(first).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });
    expect(first.items).toHaveLength(2);
    const rest = JSON.parse(resultText(await tool(c, 'list_channels').handler({ q: 'c', limit: 2, offset: 2 })));
    expect(rest.items).toHaveLength(1);
    expect(rest).not.toHaveProperty('hasMore');
  });

  it('list_thread_replies → nextCursor 를 따라 끝까지 모으고 행의 반복·빈 필드를 지운다 (#850)', async () => {
    const c = mockClient();
    vi.mocked(c.getThreadReplies)
      .mockResolvedValueOnce({ items: [reply(31)], nextCursor: 'c1', hasMore: true })
      .mockResolvedValueOnce({ items: [reply(32)], nextCursor: null, hasMore: false });
    const out = JSON.parse(resultText(await tool(c, 'list_thread_replies').handler({ messageId: 30 })));
    expect(c.getThreadReplies).toHaveBeenNthCalledWith(1, 30, { limit: 100, cursor: undefined });
    expect(c.getThreadReplies).toHaveBeenNthCalledWith(2, 30, { limit: 100, cursor: 'c1' });
    expect(out).toEqual({
      items: [
        { id: 31, authorName: '양동희', authorKind: 'HUMAN', body: '답글 31', createdAt: 't' },
        { id: 32, authorName: '양동희', authorKind: 'HUMAN', body: '답글 32', createdAt: 't' },
      ],
    });
    expect(out).not.toHaveProperty('truncated'); // 안 잘렸으면 키 자체를 싣지 않는다(빠진 키 = 끝)
  });

  it('list_thread_replies 는 500개를 넘으면 멈추고 truncated 를 알린다', async () => {
    const c = mockClient();
    const page = { items: Array.from({ length: 100 }, (_, i) => reply(i)), nextCursor: 'c', hasMore: true };
    vi.mocked(c.getThreadReplies).mockResolvedValue(page);
    const out = JSON.parse(resultText(await tool(c, 'list_thread_replies').handler({ messageId: 30 })));
    expect(c.getThreadReplies).toHaveBeenCalledTimes(5);
    expect(out.items).toHaveLength(500);
    expect(out.truncated).toBe(true);
  });

  it('toThreadReplyView 는 삭제된 답글의 deleted:true 는 남긴다', () => {
    expect(toThreadReplyView({ ...reply(33), deleted: true })).toMatchObject({ id: 33, deleted: true });
  });

  it('list_channels → 전부 담기면 { items, total } 만 돌려준다 (WP-352)', async () => {
    const c = mockClient();
    vi.mocked(c.listChannels).mockResolvedValue([{ id: 1, name: '일반' }]);
    const out = await tool(c, 'list_channels').handler({});
    expect(c.listChannels).toHaveBeenCalled();
    expect(JSON.parse(resultText(out))).toEqual({ items: [{ channelId: 1, name: '일반' }], total: 1 });
  });

  it('list_channels → limit 을 넘으면 잘라 hasMore·nextOffset 을 알리고 offset 으로 이어 읽는다 (WP-352)', async () => {
    const c = mockClient();
    vi.mocked(c.listChannels).mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `c${i}` })));
    const first = JSON.parse(resultText(await tool(c, 'list_channels').handler({ limit: 2 })));
    expect(first.items.map((x: { channelId: number }) => x.channelId)).toEqual([1, 2]);
    expect(first).toMatchObject({ total: 5, hasMore: true, nextOffset: 2 });
    const last = JSON.parse(resultText(await tool(c, 'list_channels').handler({ limit: 2, offset: 4 })));
    expect(last.items.map((x: { channelId: number }) => x.channelId)).toEqual([5]);
    expect(last).not.toHaveProperty('hasMore');
    expect(last).not.toHaveProperty('nextOffset');
  });

  it('list_channel_messages → limit 기본값 50 으로 client.listChannelMessages 호출, 다음 페이지가 없으면 { items } 만', async () => {
    const c = mockClient();
    vi.mocked(c.listChannelMessages).mockResolvedValue({ items: [{ id: 1, body: 'hi' }], nextCursor: null, hasMore: false });
    const out = await tool(c, 'list_channel_messages').handler({ channelId: 7 });
    expect(c.listChannelMessages).toHaveBeenCalledWith(7, { limit: 50, cursor: undefined });
    expect(JSON.parse(resultText(out))).toEqual({ items: [{ id: 1, body: 'hi' }] });
  });

  it('list_channel_messages → limit·cursor 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'list_channel_messages').handler({ channelId: 7, limit: 5, cursor: 'c1' });
    expect(c.listChannelMessages).toHaveBeenCalledWith(7, { limit: 5, cursor: 'c1' });
  });

  it('WP-352: list_channel_messages → 더 오래된 메시지가 있으면 hasMore:true 와 nextCursor 를 싣는다', async () => {
    const c = mockClient();
    vi.mocked(c.listChannelMessages).mockResolvedValue({ items: [{ id: 9 }], nextCursor: 'next==', hasMore: true });
    const out = JSON.parse(resultText(await tool(c, 'list_channel_messages').handler({ channelId: 7 })));
    expect(out).toEqual({ items: [{ id: 9 }], hasMore: true, nextCursor: 'next==' });
    const d = tool(c, 'list_channel_messages').description;
    expect(d).toContain('nextCursor');
    expect(d).toContain('say the list is partial');
  });

  it('옛 이름 get_channel_messages 는 더 이상 없다(WP-352)', () => {
    expect(buildMessagingTools(mockClient()).map((t) => t.name)).not.toContain('get_channel_messages');
  });

  it('add_channel_message → 멘션 없는 본문은 그대로, 옵션 없으면 parentMessageId undefined 로 호출 후 ok', async () => {
    const c = mockClient();
    const out = await tool(c, 'add_channel_message').handler({ channelId: 7, body: '안녕하세요' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(7, '안녕하세요', undefined, NO_ATTACHMENTS);
    expect(c.searchMembers).not.toHaveBeenCalled();
    expect(out).toBe('ok');
  });

  it('add_channel_message 는 body 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_channel_message').handler({ channelId: 7 })).rejects.toThrow();
    expect(c.addChannelMessage).not.toHaveBeenCalled();
  });

  // WP-423: 스테이징 파일(fileIds)·드라이브 파일(driveFileIds)을 서버 본문에 그대로 싣는다.
  it('add_channel_message: fileIds·driveFileIds 를 서버 본문에 싣는다', async () => {
    const c = mockClient();
    await tool(c, 'add_channel_message').handler({ channelId: 7, body: '첨부', fileIds: [11, 12], driveFileIds: [5] });
    expect(c.addChannelMessage).toHaveBeenCalledWith(7, '첨부', undefined, { fileIds: [11, 12], driveFileIds: [5] });
  });

  it('add_channel_message: 본문 없이 첨부만 보낼 수 있다(linkMentions 미호출)', async () => {
    const c = mockClient();
    expect(await tool(c, 'add_channel_message').handler({ channelId: 7, fileIds: [11] })).toBe('ok');
    expect(c.addChannelMessage).toHaveBeenCalledWith(7, undefined, undefined, { fileIds: [11], driveFileIds: undefined });
    expect(c.searchMembers).not.toHaveBeenCalled();
    // 공백뿐인 본문도 없는 것과 같다 — 서버 isBlank 규칙과 맞춘다. null 도 생략과 같게 받는다.
    await tool(c, 'add_channel_message').handler({ channelId: 7, body: '  ', driveFileIds: [5], fileIds: null });
    expect(c.addChannelMessage).toHaveBeenLastCalledWith(7, undefined, undefined, { fileIds: undefined, driveFileIds: [5] });
  });

  it('add_channel_message: 본문도 첨부도 없으면 거절', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_channel_message').handler({ channelId: 7 })).rejects.toThrow('본문이나 첨부');
    await expect(tool(c, 'add_channel_message').handler({ channelId: 7, body: '   ', fileIds: [], driveFileIds: [] })).rejects.toThrow('본문이나 첨부');
    expect(c.addChannelMessage).not.toHaveBeenCalled();
  });

  it('add_channel_message: 본문 길이는 클라이언트가 자르지 않고 서버에 맡긴다(멘션 변환 뒤 길이가 서버 기준)', async () => {
    const c = mockClient();
    const long = 'x'.repeat(4001);
    await tool(c, 'add_channel_message').handler({ channelId: 7, body: long });
    expect(c.addChannelMessage).toHaveBeenCalledWith(7, long, undefined, NO_ATTACHMENTS);
  });

  it('add_channel_message: 첨부 id 는 양의 정수 10개까지', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_channel_message').handler({ channelId: 7, body: 'x', fileIds: Array.from({ length: 11 }, (_, i) => i + 1) })).rejects.toThrow();
    await expect(tool(c, 'add_channel_message').handler({ channelId: 7, body: 'x', driveFileIds: [0] })).rejects.toThrow();
  });
});

describe('parentMessageIdFor — add_channel_message 스레드 mirror', () => {
  // 옛 ai-agent threadBinding({channelId:9, parentMessageId:210})을 옵션 함수로 표현한다.
  const opts: MessagingToolOptions = { parentMessageIdFor: (ch) => (ch === 9 ? 210 : undefined) };

  it('바인딩 채널과 일치하면 parentMessageId 를 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'add_channel_message', opts).handler({ channelId: 9, body: '답' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(9, '답', 210, NO_ATTACHMENTS);
  });

  it('다른 채널이면 parentMessageId 없이(인라인) 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'add_channel_message', opts).handler({ channelId: 5, body: '딴채널' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(5, '딴채널', undefined, NO_ATTACHMENTS);
  });

  it('스레드 답글(parentMessageIdFor)에도 첨부가 실린다', async () => {
    const c = mockClient();
    await tool(c, 'add_channel_message', opts).handler({ channelId: 9, fileIds: [11] });
    expect(c.addChannelMessage).toHaveBeenCalledWith(9, undefined, 210, { fileIds: [11], driveFileIds: undefined });
  });
});

// #844: 멘션 토큰은 숫자 id(<@id>)뿐이라 LLM 이 쓴 @username 을 도구가 변환한다.
describe('add_channel_message @username → <@userId> 멘션 변환', () => {
  const member = (username: string, userId: number): MemberRow => ({ userId, username, name: username, kind: 'HUMAN', active: true });
  /** 서버처럼 부분일치 검색을 흉내 — 검색어를 포함하는 행을 돌려준다. */
  const searchLike = (members: MemberRow[], fail = false) =>
    vi.fn(async (p: MemberSearchParams) => {
      if (fail) throw new Error('boom');
      return members.filter((m) => m.username.includes(p.search ?? '') || m.name.includes(p.search ?? ''));
    });
  const post = async (body: string, members: MemberRow[], failSearch = false) => {
    const c = mockClient();
    c.searchMembers = searchLike(members, failSearch);
    await tool(c, 'add_channel_message').handler({ channelId: 1, body });
    return vi.mocked(c.addChannelMessage).mock.calls[0][1];
  };

  it('구성원으로 확인된 @username 만 <@id> 로 바꾸고, 문장 끝 마침표는 보존한다', async () => {
    const out = await post('@kim.cs 확인 부탁드립니다. 참고: @lee.', [member('kim.cs', 42), member('lee', 7)]);
    expect(out).toBe('<@42> 확인 부탁드립니다. 참고: <@7>.');
  });

  it('없는 식별자·메일 주소의 @ 는 그대로 둔다', async () => {
    const out = await post('@박영희 님, a@kim.cs 로 메일 주세요 @ghost', [member('kim.cs', 42)]);
    expect(out).toBe('@박영희 님, a@kim.cs 로 메일 주세요 @ghost');
  });

  it('username 이 아니어도 표시 이름이 정확히 한 명이면 멘션하고, 동명이인이면 그대로 둔다', async () => {
    const kim = { ...member('kim.cs', 42), name: '김철수' };
    expect(await post('@김철수 확인요', [kim])).toBe('<@42> 확인요');
    const twin = { ...member('kim.cs2', 43), name: '김철수' };
    expect(await post('@김철수 확인요', [kim, twin])).toBe('@김철수 확인요');
  });

  it('이름에 붙은 호칭·조사는 떼고 찾되 원문에는 남긴다', async () => {
    const kim = { ...member('kim.cs', 42), name: '김철수' };
    expect(await post('@김철수님 확인요, @kim.cs에게도 전달', [kim])).toBe('<@42>님 확인요, <@42>에게도 전달');
  });

  it('부분일치만 되는 username 은 멘션하지 않는다(정확일치만)', async () => {
    expect(await post('@kim 안녕', [member('kim.cs', 42)])).toBe('@kim 안녕');
  });

  it('구성원 조회가 실패해도 원문 그대로 게시한다', async () => {
    expect(await post('@kim.cs 안녕', [], true)).toBe('@kim.cs 안녕');
  });

  it('멘션 해석은 활성 구성원만 대상으로 ALL 검색한다', async () => {
    const c = mockClient();
    await linkMentions(c, '@kim.cs 안녕');
    expect(c.searchMembers).toHaveBeenCalledWith({ search: 'kim.cs', kind: 'ALL', includeInactive: false, page: 0, size: 50 });
  });

  it('같은 토큰이 여러 번 나와도 조회는 한 번이고 모두 치환한다', async () => {
    const c = mockClient();
    c.searchMembers = searchLike([member('kim.cs', 42)]);
    expect(await linkMentions(c, '@kim.cs 와 @kim.cs')).toBe('<@42> 와 <@42>');
    expect(c.searchMembers).toHaveBeenCalledTimes(1);
  });

  it('@ 후보가 없으면 조회하지 않고 원문을 돌려준다', async () => {
    const c = mockClient();
    expect(await linkMentions(c, '메일은 a@b.com')).toBe('메일은 a@b.com');
    expect(c.searchMembers).not.toHaveBeenCalled();
  });

  it('코드(펜스 블록·인라인 코드) 안의 @ 는 멘션으로 바꾸지도 조회하지도 않는다(WP-1009)', async () => {
    const c = mockClient();
    c.searchMembers = searchLike([member('kim.cs', 42), member('admin', 7)]);
    const body = '@kim.cs 확인\n```java\n@admin\n@Override\n```\n`@admin` 은 코드, @admin 은 멘션';
    expect(await linkMentions(c, body)).toBe('<@42> 확인\n```java\n@admin\n@Override\n```\n`@admin` 은 코드, <@7> 은 멘션');
    expect(vi.mocked(c.searchMembers).mock.calls.map(([q]) => q.search).sort()).toEqual(['admin', 'kim.cs']);
  });

  it('멘션 수는 본문당 20개로 제한된다', async () => {
    const c = mockClient();
    const body = Array.from({ length: 25 }, (_, i) => `@u${i}`).join(' ');
    await linkMentions(c, body);
    expect(c.searchMembers).toHaveBeenCalledTimes(20);
  });

  // WP-1030: 후보 정규식이 공백에서 끊겨 `@AI 개발자1` 은 `@AI` 만 후보였다 — 첫 단어로 찾고 이름 전체를 긴 것부터 맞춘다.
  describe('공백 든 표시 이름(WP-1030)', () => {
    const agent = (name: string, username: string, userId: number): MemberRow => ({ userId, username, name, kind: 'AGENT', active: true });
    const dev1 = agent('AI 개발자1', 'developer1', 11);
    const dev10 = agent('AI 개발자10', 'developer10', 20);
    const link = (body: string, members: MemberRow[]) => {
      const c = mockClient();
      c.searchMembers = searchLike(members);
      return linkMentions(c, body);
    };

    it('이름 전체를 한 멘션으로 바꾸고 뒤 문장·호칭·조사는 원문에 남긴다', async () => {
      expect(await post('@AI 개발자1 확인 부탁', [dev1, dev10])).toBe('<@11> 확인 부탁');
      expect(await link('@AI 개발자1님 확인', [dev1, dev10])).toBe('<@11>님 확인');
      expect(await link('@AI 개발자1에게 전달', [dev1])).toBe('<@11>에게 전달');
      expect(await link('끝에 @AI 개발자1.', [dev1])).toBe('끝에 <@11>.');
    });

    it('@이름(username) 표기는 같은 username 괄호까지 삼키고, 다른 괄호는 남긴다', async () => {
      expect(await link('@AI 개발자1(developer1) 확인', [dev1, dev10])).toBe('<@11> 확인');
      expect(await link('@AI 개발자1(팀장) 확인', [dev1])).toBe('<@11>(팀장) 확인');
    });

    it('긴 이름부터 맞춰 "AI 개발자10" 과 "AI 개발자1" 을 섞지 않는다', async () => {
      expect(await link('@AI 개발자10 와 @AI 개발자1 확인', [dev1, dev10])).toBe('<@20> 와 <@11> 확인');
      // 없는 더 긴 이름(…12)은 짧은 이름의 일부로 묶지 않는다.
      expect(await link('@AI 개발자12 확인', [dev1, dev10])).toBe('@AI 개발자12 확인');
    });

    it('동명이인이면 그대로 두되 괄호 username 이 있으면 그 사람이다', async () => {
      const twin = agent('AI 개발자1', 'developer1b', 12);
      expect(await link('@AI 개발자1 확인', [dev1, twin])).toBe('@AI 개발자1 확인');
      expect(await link('@AI 개발자1(developer1b) 확인', [dev1, twin])).toBe('<@12> 확인');
    });

    it('맞는 이름이 없으면 그대로 두고, 첫 단어가 username 이면 기존처럼 그것만 바꾼다', async () => {
      expect(await link('@AI 디자이너 확인', [dev1])).toBe('@AI 디자이너 확인');
      // 첫 단어가 username 이어도 이어진 글이 공백 든 이름 전체와 맞으면 긴 쪽(이름 전체)이 이긴다.
      const team = agent('kim.cs 확인팀', 'team', 9);
      expect(await link('@kim.cs 확인 부탁', [member('kim.cs', 42), team])).toBe('<@42> 확인 부탁');
      expect(await link('@kim.cs 확인팀 부탁', [member('kim.cs', 42), team])).toBe('<@9> 부탁');
      expect(await link('@kim.cs 와 @kim.cs', [member('kim.cs', 42), dev1])).toBe('<@42> 와 <@42>');
    });

    it('코드 안의 공백 든 이름은 바꾸지 않는다', async () => {
      expect(await link('`@AI 개발자1` 은 코드, @AI 개발자1 은 멘션', [dev1])).toBe('`@AI 개발자1` 은 코드, <@11> 은 멘션');
    });

    // WP-1041: 첫 단어(`AI`)는 kai·daisy·*mail* 등에도 부분일치해 첫 페이지(50명)가 차면 대상이 밀려난다 — 두 단어 구절로 한 번 더 찾는다.
    describe('첫 단어 검색이 첫 페이지를 채울 때(WP-1041)', () => {
      const fillers = Array.from({ length: 60 }, (_, i) => member(`kai${i}`, 1000 + i));
      // 서버처럼 대소문자 무시 부분일치 + 페이지 크기만큼 자른다. 무관한 행이 앞에 와 대상을 밀어낸다.
      const pagedSearch = (members: MemberRow[]) =>
        vi.fn(async (p: MemberSearchParams) => {
          const q = (p.search ?? '').toLowerCase();
          return members.filter((m) => m.username.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, p.size);
        });
      const linkPaged = async (body: string, members: MemberRow[]) => {
        const c = mockClient();
        c.searchMembers = pagedSearch(members);
        return { out: await linkMentions(c, body), searches: vi.mocked(c.searchMembers).mock.calls.map(([q]) => q.search) };
      };

      it('두 단어 구절 검색으로 공백 든 이름을 찾아 멘션한다', async () => {
        const { out, searches } = await linkPaged('@AI 개발자1 확인 부탁', [...fillers, dev1]);
        expect(out).toBe('<@11> 확인 부탁');
        expect(searches).toEqual(['AI', 'AI 개발자1']);
      });

      it('구절의 호칭·조사는 떼고 찾으며, 긴 이름 우선·동명이인 규칙은 그대로다', async () => {
        expect((await linkPaged('@AI 개발자1님 확인', [...fillers, dev1, dev10])).out).toBe('<@11>님 확인');
        expect((await linkPaged('@AI 개발자10 와 @AI 개발자1 확인', [...fillers, dev1, dev10])).out).toBe('<@20> 와 <@11> 확인');
        const twin = agent('AI 개발자1', 'developer1b', 12);
        expect((await linkPaged('@AI 개발자1 확인', [...fillers, dev1, twin])).out).toBe('@AI 개발자1 확인');
      });

      it('첫 페이지가 차지 않으면 추가 검색을 하지 않는다', async () => {
        const { out, searches } = await linkPaged('@AI 개발자1 확인', [dev1]);
        expect(out).toBe('<@11> 확인');
        expect(searches).toEqual(['AI']);
      });

      it('구절 검색이 실패해도 원문 그대로 둔다', async () => {
        const c = mockClient();
        c.searchMembers = vi.fn(async (p: MemberSearchParams) => {
          if (p.search === 'AI') return fillers.slice(0, 50);
          throw new Error('boom');
        });
        expect(await linkMentions(c, '@AI 개발자1 확인')).toBe('@AI 개발자1 확인');
      });
    });

    it('update_channel_message 도 같은 변환을 거친다', async () => {
      const c = mockClient();
      c.searchMembers = searchLike([dev1, dev10]);
      await tool(c, 'update_channel_message').handler({ messageId: 40, body: '@AI 개발자10 확인' }).catch(() => undefined);
      expect(c.updateChannelMessage).toHaveBeenCalledWith(40, '<@20> 확인');
    });
  });
});

describe('채널·DM 쓰기 (#855)', () => {
  /** username 정확일치로만 찾히는 구성원 디렉터리. */
  const directory = (rows: MemberRow[]) => (params: MemberSearchParams) =>
    Promise.resolve(rows.filter((r) => r.username.includes(params.search ?? '')));

  it('create_channel → visibility 기본 PUBLIC', async () => {
    const c = mockClient();
    await tool(c, 'create_channel').handler({ name: '신규' });
    expect(c.createChannel).toHaveBeenCalledWith({ name: '신규', visibility: 'PUBLIC' });
  });

  it('open_dm → username 을 userId 로 해석해 열고, channelId·참여자 이름만 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockImplementation(
      directory([{ userId: 5, username: 'kim', name: '김철수' }, { userId: 6, username: 'lee', name: '이영희' }]),
    );
    vi.mocked(c.openDm).mockResolvedValue({
      id: 20,
      participants: [
        { userId: 1, name: '나', kind: 'HUMAN' },
        { userId: 5, name: '김철수', kind: 'HUMAN' },
      ],
    });
    const out = JSON.parse(resultText(await tool(c, 'open_dm').handler({ usernames: ['kim'] })));
    expect(c.openDm).toHaveBeenCalledWith([5]);
    expect(out).toEqual({ channelId: 20, participants: ['나', '김철수'] });
  });

  it('open_dm → 없거나 비활성인 username 이 섞이면 DM 을 열지 않고 모아서 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockImplementation(
      directory([
        { userId: 5, username: 'kim', name: '김철수' },
        { userId: 7, username: 'park', name: '박퇴사', active: false },
      ]),
    );
    await expect(tool(c, 'open_dm').handler({ usernames: ['kim', 'park', 'ghost'] })).rejects.toThrow('park, ghost');
    expect(c.openDm).not.toHaveBeenCalled();
  });

  it('leave_channel → 공개 채널이면 나간다', async () => {
    const c = mockClient();
    expect(await tool(c, 'leave_channel').handler({ channelId: 4 })).toBe('ok');
    expect(c.leaveChannel).toHaveBeenCalledWith(4);
  });

  it('leave_channel → 비공개 채널은 스스로 돌아올 수 없어 거절한다', async () => {
    const c = mockClient();
    vi.mocked(c.getChannel).mockResolvedValue({ id: 4, name: 'secret', visibility: 'PRIVATE' });
    await expect(tool(c, 'leave_channel').handler({ channelId: 4 })).rejects.toThrow("'secret' 은(는) 공개 채널이 아니어서");
    expect(c.leaveChannel).not.toHaveBeenCalled();
  });
});

describe('add_channel_member (WP-349)', () => {
  const directory = [
    { userId: 5, username: 'minsu', name: '김민수', active: true },
    { userId: 9, username: 'retired', name: '퇴사자', active: false },
  ];
  function withDirectory() {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockImplementation(async ({ search }) => directory.filter((m) => m.username === search));
    return c;
  }

  it('username 을 user id 로 해석해 초대하고 username·name 만 돌려준다', async () => {
    const c = withDirectory();
    const out = await tool(c, 'add_channel_member').handler({ channelId: 4, username: 'minsu' });
    expect(c.addChannelMember).toHaveBeenCalledWith(4, 5);
    expect(JSON.parse(resultText(out))).toEqual({ channelId: 4, member: { username: 'minsu', name: '김민수' } });
  });

  it('없는 username·비활성 계정은 서버를 부르지 않고 거절한다(서버는 비활성 계정을 막지 않는다)', async () => {
    const c = withDirectory();
    await expect(tool(c, 'add_channel_member').handler({ channelId: 4, username: 'ghost' })).rejects.toThrow('찾을 수 없습니다');
    await expect(tool(c, 'add_channel_member').handler({ channelId: 4, username: 'retired' })).rejects.toThrow('비활성 계정');
    expect(c.addChannelMember).not.toHaveBeenCalled();
  });
});

describe('메시징 보강 (WP-355)', () => {
  it('join_channel → 채널 id 로 참여하고 list_channels·leave_channel 설명이 이 도구를 가리킨다', async () => {
    const c = mockClient();
    expect(resultText(await tool(c, 'join_channel').handler({ channelId: 4 }))).toBe('ok');
    expect(c.joinChannel).toHaveBeenCalledWith(4);
    // 예전 문구("참여 도구가 없다 — 앱에서 사용자가 한다")가 남으면 모델이 도구가 있는데도 사용자에게 떠넘긴다.
    expect(tool(c, 'list_channels').description).toContain('join_channel');
    expect(tool(c, 'list_channels').description).not.toContain('ask the user');
    expect(tool(c, 'leave_channel').description).toContain('join_channel');
    expect(tool(c, 'leave_channel').description).not.toContain('no tool here rejoins');
  });

  it('update_channel_message → @username 을 <@id> 로 바꿔 수정하고, 저장된 행은 읽기 뷰(숫자 사용자 ID 없음)로 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 5, username: 'minsu', name: '김민수', active: true }] as MemberRow[]);
    vi.mocked(c.updateChannelMessage).mockResolvedValue({
      id: 40, channelId: 5, authorId: 9, authorName: '앨리스', authorKind: 'HUMAN', body: '@minsu 확인 부탁', mentions: [{ id: 5, username: 'minsu', name: '김민수' }],
      parentMessageId: null, replyCount: 0, reactions: [], attachments: [], driveLinks: [], createdAt: 't', editedAt: '2026-10-13T00:00:00Z', deleted: false,
      unreadReplyCount: 0, followed: false, proposal: null,
    });
    const out = JSON.parse(resultText(await tool(c, 'update_channel_message').handler({ messageId: 40, body: '@minsu 확인 부탁' })));
    expect(c.updateChannelMessage).toHaveBeenCalledWith(40, '<@5> 확인 부탁');
    expect(out).toMatchObject({ id: 40, authorName: '앨리스', editedAt: '2026-10-13T00:00:00Z' });
    expect(out).not.toHaveProperty('authorId');
    expect(out.mentions).toEqual([{ username: 'minsu', name: '김민수' }]);
  });

  it('update_channel_message → 길이 상한은 서버가 멘션 변환 뒤 본문으로 판정한다 — 도구는 빈 본문만 막는다(WP-435)', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 5, username: 'minsu', name: '김민수', active: true }] as MemberRow[]);
    // 변환 전 4000자를 넘는 본문도 zod 에서 거절하지 않고, 멘션을 토큰으로 바꿔 서버로 보낸다.
    const long = '@minsu ' + 'x'.repeat(3995);
    await tool(c, 'update_channel_message').handler({ messageId: 40, body: long });
    expect(c.updateChannelMessage).toHaveBeenCalledWith(40, '<@5> ' + 'x'.repeat(3995));
    // 서버의 400(변환 뒤 4000자 초과)을 핸들러가 삼키지 않고 도구 오류로 넘긴다(문구 요약은 rest-client·describeApiError 테스트 몫).
    vi.mocked(c.updateChannelMessage).mockRejectedValueOnce(new Error('API 오류 400: 입력값 검증에 실패했습니다. — body: 크기가 0에서 4000 사이여야 합니다'));
    await expect(tool(c, 'update_channel_message').handler({ messageId: 40, body: 'x'.repeat(4001) })).rejects.toThrow('API 오류 400');
    await expect(tool(c, 'update_channel_message').handler({ messageId: 40, body: '' })).rejects.toThrow();
  });

  it('update_channel_message → 답글 행을 고쳐도 답글 뷰(replyCount 등 생략)로 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.updateChannelMessage).mockResolvedValue({ id: 41, channelId: 5, authorId: 9, authorName: '앨리스', body: 'ok', parentMessageId: 40, replyCount: 0, followed: false });
    const out = JSON.parse(resultText(await tool(c, 'update_channel_message').handler({ messageId: 41, body: 'ok' })));
    expect(out).toEqual({ id: 41, authorName: '앨리스', body: 'ok' });
  });

  it('mark_channel_read → 가장 최근 최상위 메시지 id 까지 읽음 처리하고, 메시지가 없으면 서버를 부르지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.listChannelMessages).mockResolvedValue({ items: [{ id: 99 }], nextCursor: null, hasMore: true });
    expect(resultText(await tool(c, 'mark_channel_read').handler({ channelId: 4 }))).toBe('ok');
    expect(c.listChannelMessages).toHaveBeenCalledWith(4, { limit: 1 });
    expect(c.markChannelRead).toHaveBeenCalledWith(4, 99);

    const empty = mockClient();
    expect(resultText(await tool(empty, 'mark_channel_read').handler({ channelId: 4 }))).toBe('ok');
    expect(empty.markChannelRead).not.toHaveBeenCalled();
  });
});

describe('멘션 토큰 → 이름 (WP-353)', () => {
  const kim = { id: 3, username: 'minsu', name: '김민수', kind: 'HUMAN' };
  const lee = { id: 4, username: 'lee', name: '이AI', kind: 'AGENT' };

  it('<@id> 를 @이름(username) 으로 바꾼다(여러 명·같은 사람 반복 포함)', () => {
    expect(resolveMentionTokens('<@3> 님, <@4> 에게도: <@3> 확인', [kim, lee])).toBe('@김민수(minsu) 님, @이AI(lee) 에게도: @김민수(minsu) 확인');
  });

  it('mentions 에 없는 id(탈퇴·삭제 사용자)는 숫자를 노출하지 않고 알 수 없는 사용자로 둔다', () => {
    expect(resolveMentionTokens('<@99> 확인', [kim])).toBe('@(알 수 없는 사용자) 확인');
    expect(resolveMentionTokens('<@3> <@99>', undefined)).toBe('@(알 수 없는 사용자) @(알 수 없는 사용자)');
    expect(resolveMentionTokens('<@3>', null)).toBe('@(알 수 없는 사용자)');
    expect(resolveMentionTokens('<@3>', [])).toBe('@(알 수 없는 사용자)');
  });

  it('이름이나 username 중 하나만 있으면 있는 쪽만 쓰고, 둘 다 없으면 알 수 없는 사용자', () => {
    expect(resolveMentionTokens('<@3>', [{ id: 3, username: 'minsu', name: null }])).toBe('@minsu');
    expect(resolveMentionTokens('<@3>', [{ id: 3, username: '', name: '김민수' }])).toBe('@김민수');
    expect(resolveMentionTokens('<@3>', [{ id: 3, username: null, name: null }])).toBe('@(알 수 없는 사용자)');
  });

  it('토큰이 아닌 텍스트·형식이 틀린 토큰은 건드리지 않는다', () => {
    expect(resolveMentionTokens('메일 a@b.com 과 <@abc> 와 <@ 3> 와 @3', [kim])).toBe('메일 a@b.com 과 <@abc> 와 <@ 3> 와 @3');
    expect(resolveMentionTokens('', [kim])).toBe('');
  });

  it('mentions 항목의 id 가 문자열이어도 풀린다', () => {
    expect(resolveMentionTokens('<@3>', [{ ...kim, id: '3' }])).toBe('@김민수(minsu)');
  });

  it('list_channel_messages·list_thread_replies 는 본문을 풀고 mentions 에서 id 를 뺀다', async () => {
    const c = mockClient();
    const row = { id: 40, channelId: 5, authorId: 9, authorName: '앨리스', authorKind: 'HUMAN', body: '<@3> 확인 부탁, <@77> 도', mentions: [kim], parentMessageId: null, replyCount: 1 };
    vi.mocked(c.listChannelMessages).mockResolvedValue({ items: [row], nextCursor: null, hasMore: false });
    vi.mocked(c.getThreadReplies).mockResolvedValue({ items: [{ ...row, id: 41, parentMessageId: 40 }], nextCursor: null, hasMore: false });
    const page = JSON.parse(resultText(await tool(c, 'list_channel_messages').handler({ channelId: 5 })));
    expect(page.items[0].body).toBe('@김민수(minsu) 확인 부탁, @(알 수 없는 사용자) 도');
    expect(page.items[0].mentions).toEqual([{ username: 'minsu', name: '김민수', kind: 'HUMAN' }]);
    const replies = JSON.parse(resultText(await tool(c, 'list_thread_replies').handler({ messageId: 40 })));
    expect(replies.items[0].body).toBe('@김민수(minsu) 확인 부탁, @(알 수 없는 사용자) 도');
    expect(replies.items[0].mentions).toEqual([{ username: 'minsu', name: '김민수', kind: 'HUMAN' }]);
    expect(resultText(await tool(c, 'list_channel_messages').handler({ channelId: 5 }))).not.toMatch(/<@\d+>/);
  });

  it('linkMentions 는 출력 표기 @이름(username) 을 따라 써도 같은 멘션 하나로 읽는다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수', active: true } as MemberRow]);
    expect(await linkMentions(c, '확인 @김민수(minsu) 부탁')).toBe('확인 <@3> 부탁');
    // username 과 다른 괄호는 원문을 살린다.
    expect(await linkMentions(c, '확인 @김민수(팀장) 부탁')).toBe('확인 <@3>(팀장) 부탁');
    // 이미 username 으로 쓴 경우는 그대로 동작한다.
    expect(await linkMentions(c, '확인 @minsu 부탁')).toBe('확인 <@3> 부탁');
  });

  // 동명이인 대비(WP-353 최종 리뷰): 이름만으로는 한 명이 안 정해져도 괄호 username 이 가린다.
  it('linkMentions 는 @이름(username) 이면 괄호 안 username 을 먼저 써서 동명이인을 가린다', async () => {
    const c = mockClient();
    const twins = [
      { userId: 3, username: 'minsu', name: '김민수', active: true },
      { userId: 4, username: 'minsu2', name: '김민수', active: true },
    ] as MemberRow[];
    c.searchMembers = vi.fn(async ({ search }: { search?: string }) => twins.filter((m) => m.username.includes(search ?? '') || (m.name ?? '').includes(search ?? '')));
    // 이름만 쓰면 동명이인이라 멘션하지 않지만(기존 동작), 괄호 username 이 있으면 그 사람이다.
    expect(await linkMentions(c, '확인 @김민수 부탁')).toBe('확인 @김민수 부탁');
    expect(await linkMentions(c, '확인 @김민수(minsu2) 부탁')).toBe('확인 <@4> 부탁');
    expect(await linkMentions(c, '@김민수(minsu) 와 @김민수(minsu2)')).toBe('<@3> 와 <@4>');
    // 조사가 붙어도 이름 부분만 멘션으로 바꾸고 조사는 남긴다. 표시 이름과 다른 표기여도 username 이 맞으면 따른다.
    expect(await linkMentions(c, '@김민수님(minsu2) 확인')).toBe('<@4>님 확인');
    expect(await linkMentions(c, '@민수씨(minsu) 확인')).toBe('<@3> 확인');
    // 괄호 username 이 없는 구성원이면 이름 해석으로 되돌아간다(동명이인이면 그대로).
    expect(await linkMentions(c, '@김민수(nobody) 확인')).toBe('@김민수(nobody) 확인');
  });
});

describe('메시지·채널 정리 뷰 (WP-353)', () => {
  const full = {
    id: 40, channelId: 5, authorId: 9, authorName: '앨리스', authorKind: 'HUMAN', body: '안녕', mentions: [], parentMessageId: null, replyCount: 0,
    reactions: [{ emoji: '👍', count: 2, reacted: true }, { emoji: '🎉', count: 1, reacted: false }],
    attachments: [{ fileId: 70, messageId: 40, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 3, attachedById: 9, attachedByName: '앨리스', attachedAt: 't' }],
    driveLinks: [{ driveFileId: 8, fileId: 801, name: 'd.pdf', mimeType: 'application/pdf', sizeBytes: 5, hasThumbnail: false, spaceId: 2, spaceName: '팀', availability: 'OK', createdById: 9, createdAt: 't' }],
    createdAt: '2026-10-01T00:00:00Z', editedAt: null, deleted: false, unreadReplyCount: 0, followed: false, proposal: null,
  };

  it('최상위 행: 리액션은 { 이모지: 개수 }, 첨부·드라이브 링크는 핵심만, 반복·기본값 키는 뺀다', () => {
    const v = toMessageView(full);
    expect(v).toEqual({
      id: 40, authorName: '앨리스', authorKind: 'HUMAN', body: '안녕', reactions: { '👍': 2, '🎉': 1 },
      attachments: [{ fileId: 70, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 3 }],
      driveLinks: [{ driveFileId: 8, name: 'd.pdf', mimeType: 'application/pdf', sizeBytes: 5, spaceId: 2, spaceName: '팀', availability: 'OK' }],
      createdAt: '2026-10-01T00:00:00Z',
    });
    expect(JSON.stringify(v).length).toBeLessThan(JSON.stringify(full).length * 0.6);
  });

  it('최상위 행은 답글·미읽음 답글·팔로우가 있을 때만 그 값을 남기고, 답글 행(thread)은 항상 뺀다', () => {
    const top = toMessageView({ ...full, replyCount: 3, unreadReplyCount: 1, followed: true });
    expect(top).toMatchObject({ replyCount: 3, unreadReplyCount: 1, followed: true });
    const reply = toMessageView({ ...full, replyCount: 3, unreadReplyCount: 1, followed: true }, true);
    expect(reply).not.toHaveProperty('replyCount');
    expect(reply).not.toHaveProperty('unreadReplyCount');
    expect(reply).not.toHaveProperty('followed');
  });

  it('삭제된 메시지는 deleted:true 를 남기고, 제안 카드는 id·빈 필드를 뺀다', () => {
    const v = toMessageView({
      ...full, body: '(삭제됨)', deleted: true,
      proposal: { id: 1, proposedByUserId: 9, actionType: 'CREATE_ISSUE', status: 'PENDING', title: '버그', priority: 'HIGH', projectName: null, resultIssueKey: null, projectKey: 'WP', candidates: [], startsAt: null, attendees: null },
    });
    expect(v).toMatchObject({ deleted: true, body: '(삭제됨)' });
    expect(v.proposal).toEqual({ actionType: 'CREATE_ISSUE', status: 'PENDING', title: '버그', priority: 'HIGH', projectKey: 'WP' });
  });

  it('리액션이 없거나 모양이 이상하면 reactions 키를 생략한다', () => {
    expect(toMessageView({ ...full, reactions: [] })).not.toHaveProperty('reactions');
    expect(toMessageView({ ...full, reactions: null })).not.toHaveProperty('reactions');
    expect(toMessageView({ ...full, reactions: [{ count: 1 }] })).not.toHaveProperty('reactions');
  });

  it('body 가 없는 행도 던지지 않는다', () => {
    expect(() => toMessageView({ id: 1 })).not.toThrow();
  });

  const channel = {
    id: 5, kind: 'PUBLIC', name: '일반', visibility: 'PUBLIC', member: true, role: 'MEMBER', archived: false, memberCount: 3, unreadCount: 0, createdAt: '2026-01-01T00:00:00Z',
    hasUnreadThreads: false, lastReadMessageId: 39, lastMessage: { id: 40, authorId: 9, authorName: '앨리스', preview: '안녕', createdAt: 't' },
  };

  it('채널 행: lastReadMessageId 와 0·false 플래그·값 없는 키를 빼고, 안 읽은 게 있으면 그 값을 남긴다', () => {
    expect(toChannelView(channel)).toEqual({
      channelId: 5, kind: 'PUBLIC', name: '일반', visibility: 'PUBLIC', member: true, role: 'MEMBER', memberCount: 3, createdAt: '2026-01-01T00:00:00Z',
      lastMessage: { id: 40, authorName: '앨리스', preview: '안녕', createdAt: 't' },
    });
    expect(toChannelView({ ...channel, unreadCount: 4, hasUnreadThreads: true, archived: true, role: null, lastMessage: null })).toMatchObject({ unreadCount: 4, hasUnreadThreads: true, archived: true });
    expect(toChannelView({ ...channel, role: null, lastMessage: null })).not.toHaveProperty('role');
    expect(JSON.stringify(toChannelView(channel)).length).toBeLessThan(JSON.stringify(channel).length * 0.85);
  });

  it('list_channels 설명은 생략 규칙(unreadCount·hasUnreadThreads)을 안내한다', () => {
    expect(tool(mockClient(), 'list_channels').description).toMatch(/unreadCount/);
  });
});

