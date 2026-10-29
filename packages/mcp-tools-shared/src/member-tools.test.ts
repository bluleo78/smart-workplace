import { describe, expect, it, vi } from 'vitest';
import { buildMemberTools, findMemberByUsername, toContactView } from './member-tools.js';
import type { CurrentUserClient } from './resolve.js';
import type { MemberToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

/** 구성원·연락처 클라이언트 mock. */
function mockClient(): MemberToolClient & CurrentUserClient {
  return {
    getMe: vi.fn().mockResolvedValue({ id: 1, username: 'me-user' }),
    searchMembers: vi.fn().mockResolvedValue([]),
    searchMembersPage: vi.fn().mockResolvedValue({ items: [], hasMore: false, page: 0 }),
    getMember: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    getMemberContact: vi.fn().mockResolvedValue({}),
    listContacts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getExternalContact: vi.fn().mockResolvedValue({}),
    listChannelMembers: vi.fn().mockResolvedValue([]),
  };
}

const tool = (c: MemberToolClient & CurrentUserClient, name: string) => buildMemberTools(c).find((x) => x.name === name)!;

describe('get_member 의 me (WP-376)', () => {
  const aiRow = { userId: 7, username: 'ai-dev', name: 'AI 개발', kind: 'AGENT' };

  it("get_member: username 'me' 는 호출자(getMe)의 id 로 단건을 읽는다 — username 검색을 거치지 않는다", async () => {
    const c = mockClient();
    vi.mocked(c.getMe).mockResolvedValue({ id: 7, username: 'ai-dev' });
    vi.mocked(c.getMember).mockResolvedValue(aiRow);
    const out = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: 'me' })));
    expect(out).toEqual({ username: 'ai-dev', name: 'AI 개발', kind: 'AGENT' });
    expect(c.getMe).toHaveBeenCalledTimes(1);
    expect(c.getMember).toHaveBeenCalledWith(7);
    expect(c.searchMembers).not.toHaveBeenCalled();
  });

  it("get_member: 'me' 는 username 이 짧아 부분일치 검색 첫 페이지(50건)에 들지 않아도 찾는다", async () => {
    const c = mockClient();
    vi.mocked(c.getMe).mockResolvedValue({ id: 99, username: 'ai' });
    // 'ai' 를 포함한 다른 구성원 50명으로 첫 페이지가 찬다 — 이전 구현(username 재검색)은 여기서 "없음" 이었다.
    vi.mocked(c.searchMembers).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ userId: i + 1, username: `ai-bot-${i}`, name: `AI ${i}`, kind: 'AGENT' })),
    );
    vi.mocked(c.getMember).mockResolvedValue({ userId: 99, username: 'ai', name: 'AI', kind: 'AGENT', active: true });
    const out = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: 'me' })));
    expect(out).toEqual({ username: 'ai', name: 'AI', kind: 'AGENT', active: true });
  });

  it("get_member: 'me' 는 서버가 실어 준 지시(instructions)를 그대로 준다 — 비어 있으면 키째 뺀다 (WP-1077)", async () => {
    const c = mockClient();
    vi.mocked(c.getMe).mockResolvedValue({ id: 7, username: 'ai-dev' });
    vi.mocked(c.getMember).mockResolvedValue({ ...aiRow, instructions: '다른 서비스를 참고한다' });
    const out = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: 'me' })));
    expect(out.instructions).toBe('다른 서비스를 참고한다');

    vi.mocked(c.getMember).mockResolvedValue({ ...aiRow, instructions: null });
    const empty = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: 'me' })));
    expect(empty).not.toHaveProperty('instructions');
    expect(tool(c, 'get_member').description).toContain('instructions');
  });

  it("get_member: 'me' 는 서버가 실어 준 동시 진행 자리(slots)를 그대로 준다 — work-loop 가 상한 판단에 쓴다 (WP-1205)", async () => {
    const c = mockClient();
    vi.mocked(c.getMe).mockResolvedValue({ id: 7, username: 'ai-dev' });
    const slots = { used: 2, limit: 3, issues: ['WP-1', 'WD-2'] };
    vi.mocked(c.getMember).mockResolvedValue({ ...aiRow, slots });
    const out = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: 'me' })));
    expect(out.slots).toEqual(slots);
    expect(tool(c, 'get_member').description).toContain('slots');
  });

  it("get_member: ' ME ' 도 호출자다", async () => {
    const c = mockClient();
    vi.mocked(c.getMe).mockResolvedValue({ id: 7, username: 'ai-dev' });
    vi.mocked(c.getMember).mockResolvedValue(aiRow);
    const out = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: ' ME ' })));
    expect(out.username).toBe('ai-dev');
  });

  it("get_member: 'me' 단건 조회 오류는 그대로 전파한다(없음으로 뭉개지 않는다)", async () => {
    const c = mockClient();
    await expect(tool(c, 'get_member').handler({ username: 'me' })).rejects.toEqual({ response: { status: 404 } });
  });

  it("get_member: 'me' 가 아니면 getMe 를 부르지 않는다", async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([aiRow]);
    await tool(c, 'get_member').handler({ username: 'ai-dev' });
    expect(c.getMe).not.toHaveBeenCalled();
    expect(c.getMember).not.toHaveBeenCalled();
  });
});

describe('buildMemberTools (#833)', () => {
  it('정확히 5종을 반환하고 쓰기 도구는 노출하지 않는다', () => {
    const names = buildMemberTools(mockClient()).map((t) => t.name);
    expect(names.sort()).toEqual(
      ['get_external_contact', 'get_member', 'get_member_contact', 'list_contacts', 'search_members'].sort(),
    );
    expect(names.some((n) => n.startsWith('propose_'))).toBe(false);
  });

  it('search_members → kind 기본값 HUMAN, page 0, size 20 으로 client.searchMembersPage 호출', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembersPage).mockResolvedValue({ items: [{ userId: 3, username: 'minsu', name: '김민수' }], total: 1, hasMore: false, page: 0 });
    const out = await tool(c, 'search_members').handler({ search: '김' });
    expect(c.searchMembersPage).toHaveBeenCalledWith({ search: '김', kind: 'HUMAN', page: 0, size: 20 });
    // 마지막 페이지면 total 만 싣고 hasMore·nextPage 는 생략한다(WP-352).
    // 숫자 userId 는 내보내지 않는다 — 사람은 username 으로(#833, WP-353).
    expect(JSON.parse(resultText(out))).toEqual({ items: [{ username: 'minsu', name: '김민수' }], total: 1 });
  });

  it('WP-352: search_members 는 다음 페이지가 있으면 hasMore:true·nextPage·total 을 싣는다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembersPage).mockResolvedValue({ items: [{ userId: 3, username: 'minsu', name: '김민수' }], total: 45, hasMore: true, page: 0 });
    const out = JSON.parse(resultText(await tool(c, 'search_members').handler({ search: '김', size: 20 })));
    expect(out).toEqual({ items: [{ username: 'minsu', name: '김민수' }], total: 45, hasMore: true, nextPage: 1 });
    expect(tool(c, 'search_members').description).toContain('say the list is partial');
  });

  it('WP-455: search_members 는 AI 행에 설명·실행 방식을 싣고, 사람 행에는 빈 칸을 붙이지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembersPage).mockResolvedValue({
      items: [
        { userId: 7, username: 'review-ai', name: '리뷰봇', kind: 'AGENT', description: '코드 리뷰를 맡습니다', agentRuntime: 'EXTERNAL' },
        { userId: 3, username: 'minsu', name: '김민수', kind: 'HUMAN', description: null, agentRuntime: null },
      ],
      total: 2,
      hasMore: false,
      page: 0,
    });
    const out = JSON.parse(resultText(await tool(c, 'search_members').handler({ kind: 'ALL' })));
    expect(out.items).toEqual([
      { username: 'review-ai', name: '리뷰봇', kind: 'AGENT', description: '코드 리뷰를 맡습니다', agentRuntime: 'EXTERNAL' },
      { username: 'minsu', name: '김민수', kind: 'HUMAN' },
    ]);
    // 넘기는 AI 가 설명으로 상대를 고르고, 내부 AI 는 맡겨도 시작하지 않는다는 것을 도구 설명에서 알 수 있어야 한다.
    expect(tool(c, 'search_members').description).toContain('agentRuntime (INTERNAL|EXTERNAL)');
  });

  describe('search_members 의 channelId (WP-355)', () => {
    const roster = [
      { userId: 1, username: 'owner', name: '양동희', kind: 'HUMAN', role: 'OWNER', joinedAt: 't' },
      { userId: 2, username: 'minsu', name: '김민수', kind: 'HUMAN', role: 'MEMBER', joinedAt: 't' },
      { userId: 3, username: 'minji', name: '김민지', kind: 'HUMAN', role: 'ADMIN', joinedAt: 't' },
      { userId: 4, username: 'bot', name: 'AI 비서', kind: 'AGENT', role: 'MEMBER', joinedAt: 't' },
    ];
    const withRoster = () => {
      const c = mockClient();
      vi.mocked(c.listChannelMembers).mockResolvedValue(roster);
      return c;
    };

    it('채널 멤버를 읽어 같은 출력 모양으로 돌려주고, 구성원 검색 API 는 부르지 않으며 숫자 userId·가입 시각은 내보내지 않는다', async () => {
      const c = withRoster();
      const out = JSON.parse(resultText(await tool(c, 'search_members').handler({ channelId: 9 })));
      expect(c.listChannelMembers).toHaveBeenCalledWith(9);
      expect(c.searchMembersPage).not.toHaveBeenCalled();
      // kind 기본값 HUMAN — 구성원 검색과 같아 AI 비서(AGENT)는 빠진다.
      expect(out).toEqual({
        items: [
          { username: 'owner', name: '양동희', kind: 'HUMAN', role: 'OWNER' },
          { username: 'minsu', name: '김민수', kind: 'HUMAN', role: 'MEMBER' },
          { username: 'minji', name: '김민지', kind: 'HUMAN', role: 'ADMIN' },
        ],
        total: 3,
      });
      expect(JSON.stringify(out)).not.toContain('userId');
    });

    it('search 는 이름·username 부분일치(대소문자 무시), kind ALL 은 AI 도 포함한다', async () => {
      const c = withRoster();
      expect(JSON.parse(resultText(await tool(c, 'search_members').handler({ channelId: 9, search: '김민' }))).items.map((m: { username: string }) => m.username)).toEqual(['minsu', 'minji']);
      expect(JSON.parse(resultText(await tool(c, 'search_members').handler({ channelId: 9, search: 'BOT', kind: 'ALL' }))).items).toEqual([
        { username: 'bot', name: 'AI 비서', kind: 'AGENT', role: 'MEMBER' },
      ]);
    });

    it('size 로 자르면 hasMore·nextPage·total 을 싣고 nextPage 로 이어 읽는다', async () => {
      const c = withRoster();
      const first = JSON.parse(resultText(await tool(c, 'search_members').handler({ channelId: 9, size: 2 })));
      expect(first).toMatchObject({ total: 3, hasMore: true, nextPage: 1 });
      expect(first.items).toHaveLength(2);
      const second = JSON.parse(resultText(await tool(c, 'search_members').handler({ channelId: 9, size: 2, page: first.nextPage })));
      expect(second.items.map((m: { username: string }) => m.username)).toEqual(['minji']);
      expect(second).not.toHaveProperty('hasMore');
    });

    it('channelId 가 없으면 이전처럼 구성원 검색만 하고 채널 멤버는 읽지 않는다', async () => {
      const c = withRoster();
      await tool(c, 'search_members').handler({ search: '김' });
      expect(c.listChannelMembers).not.toHaveBeenCalled();
      expect(c.searchMembersPage).toHaveBeenCalled();
    });
  });

  it('get_member 는 username 정확일치 항목을 돌려준다(비활성 포함·ALL 로 조회)', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([
      { userId: 4, username: 'minsu2', name: '김민수2' },
      { userId: 3, username: 'minsu', name: '김민수' },
    ]);
    const out = JSON.parse(resultText(await tool(c, 'get_member').handler({ username: 'minsu' })));
    expect(out).toMatchObject({ username: 'minsu', name: '김민수' });
    expect(out).not.toHaveProperty('userId');
    expect(c.searchMembers).toHaveBeenCalledWith({
      search: 'minsu',
      kind: 'ALL',
      includeInactive: true,
      page: 0,
      size: 50,
    });
  });

  it('get_member 는 username 누락을 거부하고, 없는 username 은 성공 문자열이 아니라 오류로 던진다', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_member').handler({})).rejects.toThrow();
    await expect(tool(c, 'get_member').handler({ username: 'ghost' })).rejects.toThrow(/구성원을 찾을 수 없습니다: ghost/);
  });

  it('get_member_contact 는 응답의 공용 id(= 숫자 사용자 ID)를 내보내지 않고 username·name 으로 가리킨다 (#833, WP-353)', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수' }]);
    // 서버 MemberDetail 모양 — id 외에 username·name 이 이미 함께 온다.
    vi.mocked(c.getMemberContact).mockResolvedValue({
      id: 3, username: 'minsu', name: '김민수', email: 'm@x.com', title: '팀장', kind: 'HUMAN', groups: ['팀A'], isFavorite: true,
    });
    const out = JSON.parse(resultText(await tool(c, 'get_member_contact').handler({ username: 'minsu' })));
    expect(c.getMemberContact).toHaveBeenCalledWith(3);
    expect(out).toEqual({ username: 'minsu', name: '김민수', email: 'm@x.com', title: '팀장', kind: 'HUMAN', groups: ['팀A'], isFavorite: true });
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('userId');
  });

  it('get_member_contact 는 groups 가 없으면 [] 로 채운다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수' }]);
    vi.mocked(c.getMemberContact).mockResolvedValue({ id: 3, username: 'minsu' });
    const out = JSON.parse(resultText(await tool(c, 'get_member_contact').handler({ username: 'minsu' })));
    expect(out).toEqual({ username: 'minsu', groups: [] });
  });

  it('get_member_contact 는 없는 username 이면 연락처를 조회하지 않고 오류로 던진다', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_member_contact').handler({ username: 'ghost' })).rejects.toThrow(/구성원을 찾을 수 없습니다: ghost/);
    expect(c.getMemberContact).not.toHaveBeenCalled();
  });

  it('list_contacts 는 MEMBER→username, EXTERNAL→externalId 로 분리하고 공용 id·userId 를 내보내지 않는다', async () => {
    // 두 타입이 같은 숫자 id 를 갖는 상황이 정확히 오용의 원인이었다 — 같은 값으로 검증한다.
    const c = mockClient();
    vi.mocked(c.listContacts).mockResolvedValue({
      items: [
        { id: 7, type: 'MEMBER', username: 'kim', name: '김구성원', email: 'm@x.com', title: null, organization: null, isFavorite: false },
        { id: 7, type: 'EXTERNAL', name: '김외부', email: 'e@x.com', title: null, organization: 'X사', isFavorite: true },
      ],
      nextCursor: 'c1',
    });
    const out = JSON.parse(resultText(await tool(c, 'list_contacts').handler({ limit: 20 }))) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(out.items[0]).toMatchObject({ type: 'MEMBER', username: 'kim' });
    expect(out.items[0]).not.toHaveProperty('externalId');
    expect(out.items[0]).not.toHaveProperty('userId'); // 숫자 사용자 ID 는 내보내지 않는다(WP-353)
    expect(out.items[1]).toMatchObject({ type: 'EXTERNAL', externalId: 7, organization: 'X사', isFavorite: true });
    expect(out.items[1]).not.toHaveProperty('userId');
    expect(out.items[0]).not.toHaveProperty('id');
    expect(out.items[1]).not.toHaveProperty('id');
    expect(out.nextCursor).toBe('c1');
  });

  it('list_contacts 는 limit 기본값 20 으로 조회한다', async () => {
    const c = mockClient();
    await tool(c, 'list_contacts').handler({ type: 'EXTERNAL' });
    expect(c.listContacts).toHaveBeenCalledWith({ type: 'EXTERNAL', limit: 20 });
  });

  it('list_contacts 는 null 응답이면 빈 목록을 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.listContacts).mockResolvedValue(null);
    expect(JSON.parse(resultText(await tool(c, 'list_contacts').handler({})))).toEqual({ items: [] });
  });

  it('list_contacts → 다음 페이지가 있으면 hasMore·nextCursor, 없으면 생략한다 (WP-352)', async () => {
    const c = mockClient();
    vi.mocked(c.listContacts).mockResolvedValue({ items: [{ type: 'MEMBER', name: '김', username: 'kim' }], nextCursor: 'c2' });
    expect(JSON.parse(resultText(await tool(c, 'list_contacts').handler({})))).toMatchObject({ hasMore: true, nextCursor: 'c2' });
    vi.mocked(c.listContacts).mockResolvedValue({ items: [], nextCursor: null });
    const last = JSON.parse(resultText(await tool(c, 'list_contacts').handler({})));
    expect(last).not.toHaveProperty('nextCursor');
    expect(last).not.toHaveProperty('hasMore');
  });

  it('get_external_contact 는 externalId 를 받는다 — id/userId 키는 스키마 거부', async () => {
    const c = mockClient();
    vi.mocked(c.getExternalContact).mockResolvedValue({ id: 3, name: '외부' });
    await tool(c, 'get_external_contact').handler({ externalId: 3 });
    expect(c.getExternalContact).toHaveBeenCalledWith(3);
    await expect(tool(c, 'get_external_contact').handler({ id: 3 })).rejects.toThrow();
    await expect(tool(c, 'get_external_contact').handler({ userId: 3 })).rejects.toThrow();
  });
});

describe('toContactView', () => {
  it('누락 필드는 null/false 로 채우고 타입별 식별자만 둔다', () => {
    expect(toContactView({ type: 'MEMBER', id: 1, name: 'a' })).toEqual({
      type: 'MEMBER',
      name: 'a',
      email: null,
      title: null,
      organization: null,
      isFavorite: false,
      username: null,
    });
  });
});

describe('#833 구성원 해석 (findMemberByUsername)', () => {
  it('조회 오류는 비구성원으로 뭉개지 않고 그대로 전파한다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockRejectedValue({ response: { status: 403 } });
    await expect(findMemberByUsername(c, 'minsu')).rejects.toEqual({ response: { status: 403 } });
    // 도구 경로도 동일 — "찾을 수 없음" 오류로 바꾸지 않는다.
    await expect(tool(c, 'get_member').handler({ username: 'minsu' })).rejects.toBeDefined();
  });

  it('부분일치는 채택하지 않는다 — username 정확일치만', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([
      { userId: 7, username: 'minsu2', name: '김민수2', kind: 'HUMAN', active: true },
    ]);
    expect(await findMemberByUsername(c, 'minsu')).toBeUndefined();
    await expect(tool(c, 'get_member').handler({ username: 'minsu' })).rejects.toThrow('찾을 수 없습니다');
  });
});
