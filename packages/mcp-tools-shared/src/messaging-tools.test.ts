import { describe, expect, it, vi } from 'vitest';
import { buildMessagingTools, linkMentions, toThreadReplyView, type MessagingToolOptions } from './messaging-tools.js';
import type { MemberRow, MemberSearchParams, MemberToolClient, MessagingToolClient } from './tool-client.js';

type Client = MessagingToolClient & Pick<MemberToolClient, 'searchMembers'>;

/** 메시징 + 구성원 검색(멘션 변환용) mock. */
function mockClient(): Client {
  return {
    listChannels: vi.fn().mockResolvedValue([]),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    getThreadReplies: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    searchMembers: vi.fn().mockResolvedValue([]),
    getChannel: vi.fn().mockResolvedValue({ id: 4, name: 'general', visibility: 'PUBLIC' }),
    createChannel: vi.fn().mockResolvedValue({ id: 12, name: 'new', visibility: 'PUBLIC' }),
    openDm: vi.fn().mockResolvedValue({ id: 20, participants: [] }),
    leaveChannel: vi.fn().mockResolvedValue(undefined),
  };
}

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

  it('get_thread_replies → nextCursor 를 따라 끝까지 모으고 행의 반복·빈 필드를 지운다 (#850)', async () => {
    const c = mockClient();
    vi.mocked(c.getThreadReplies)
      .mockResolvedValueOnce({ items: [reply(31)], nextCursor: 'c1', hasMore: true })
      .mockResolvedValueOnce({ items: [reply(32)], nextCursor: null, hasMore: false });
    const out = JSON.parse(await tool(c, 'get_thread_replies').handler({ messageId: 30 }));
    expect(c.getThreadReplies).toHaveBeenNthCalledWith(1, 30, { limit: 100, cursor: undefined });
    expect(c.getThreadReplies).toHaveBeenNthCalledWith(2, 30, { limit: 100, cursor: 'c1' });
    expect(out).toEqual({
      items: [
        { id: 31, authorName: '양동희', authorKind: 'HUMAN', body: '답글 31', createdAt: 't' },
        { id: 32, authorName: '양동희', authorKind: 'HUMAN', body: '답글 32', createdAt: 't' },
      ],
      truncated: false,
    });
  });

  it('get_thread_replies 는 500개를 넘으면 멈추고 truncated 를 알린다', async () => {
    const c = mockClient();
    const page = { items: Array.from({ length: 100 }, (_, i) => reply(i)), nextCursor: 'c', hasMore: true };
    vi.mocked(c.getThreadReplies).mockResolvedValue(page);
    const out = JSON.parse(await tool(c, 'get_thread_replies').handler({ messageId: 30 }));
    expect(c.getThreadReplies).toHaveBeenCalledTimes(5);
    expect(out.items).toHaveLength(500);
    expect(out.truncated).toBe(true);
  });

  it('toThreadReplyView 는 삭제된 답글의 deleted:true 는 남긴다', () => {
    expect(toThreadReplyView({ ...reply(33), deleted: true })).toMatchObject({ id: 33, deleted: true });
  });

  it('list_channels → client.listChannels()', async () => {
    const c = mockClient();
    vi.mocked(c.listChannels).mockResolvedValue([{ id: 1, name: '일반' }]);
    const out = await tool(c, 'list_channels').handler({});
    expect(c.listChannels).toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual([{ id: 1, name: '일반' }]);
  });

  it('get_channel_messages → limit 기본값 50 으로 client.getChannelMessages 호출', async () => {
    const c = mockClient();
    vi.mocked(c.getChannelMessages).mockResolvedValue([{ id: 1, body: 'hi' }]);
    const out = await tool(c, 'get_channel_messages').handler({ channelId: 7 });
    expect(c.getChannelMessages).toHaveBeenCalledWith(7, 50);
    expect(JSON.parse(out)).toEqual([{ id: 1, body: 'hi' }]);
  });

  it('get_channel_messages → limit 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'get_channel_messages').handler({ channelId: 7, limit: 5 });
    expect(c.getChannelMessages).toHaveBeenCalledWith(7, 5);
  });

  it('add_channel_message → 멘션 없는 본문은 그대로, 옵션 없으면 parentMessageId undefined 로 호출 후 ok', async () => {
    const c = mockClient();
    const out = await tool(c, 'add_channel_message').handler({ channelId: 7, body: '안녕하세요' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(7, '안녕하세요', undefined);
    expect(c.searchMembers).not.toHaveBeenCalled();
    expect(out).toBe('ok');
  });

  it('add_channel_message 는 body 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_channel_message').handler({ channelId: 7 })).rejects.toThrow();
    expect(c.addChannelMessage).not.toHaveBeenCalled();
  });
});

describe('parentMessageIdFor — add_channel_message 스레드 mirror', () => {
  // 옛 ai-agent threadBinding({channelId:9, parentMessageId:210})을 옵션 함수로 표현한다.
  const opts: MessagingToolOptions = { parentMessageIdFor: (ch) => (ch === 9 ? 210 : undefined) };

  it('바인딩 채널과 일치하면 parentMessageId 를 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'add_channel_message', opts).handler({ channelId: 9, body: '답' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(9, '답', 210);
  });

  it('다른 채널이면 parentMessageId 없이(인라인) 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'add_channel_message', opts).handler({ channelId: 5, body: '딴채널' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(5, '딴채널', undefined);
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

  it('멘션 수는 본문당 20개로 제한된다', async () => {
    const c = mockClient();
    const body = Array.from({ length: 25 }, (_, i) => `@u${i}`).join(' ');
    await linkMentions(c, body);
    expect(c.searchMembers).toHaveBeenCalledTimes(20);
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
    const out = JSON.parse(await tool(c, 'open_dm').handler({ usernames: ['kim'] }));
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
