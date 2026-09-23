import { describe, expect, it, vi } from 'vitest';
import { buildMemberTools, findMemberByUsername, toContactView } from './member-tools.js';
import type { MemberToolClient } from './tool-client.js';

/** 구성원·연락처 클라이언트 mock. */
function mockClient(): MemberToolClient {
  return {
    searchMembers: vi.fn().mockResolvedValue([]),
    getMemberContact: vi.fn().mockResolvedValue({}),
    listContacts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getExternalContact: vi.fn().mockResolvedValue({}),
  };
}

const tool = (c: MemberToolClient, name: string) => buildMemberTools(c).find((x) => x.name === name)!;

describe('buildMemberTools (#833)', () => {
  it('정확히 5종을 반환하고 쓰기 도구는 노출하지 않는다', () => {
    const names = buildMemberTools(mockClient()).map((t) => t.name);
    expect(names.sort()).toEqual(
      ['get_external_contact', 'get_member', 'get_member_contact', 'list_contacts', 'search_members'].sort(),
    );
    expect(names.some((n) => n.startsWith('propose_'))).toBe(false);
  });

  it('search_members → kind 기본값 HUMAN, page 0, size 20 으로 client.searchMembers 호출', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수' }]);
    const out = await tool(c, 'search_members').handler({ search: '김' });
    expect(c.searchMembers).toHaveBeenCalledWith({ search: '김', kind: 'HUMAN', page: 0, size: 20 });
    expect(JSON.parse(out)).toEqual([{ userId: 3, username: 'minsu', name: '김민수' }]);
  });

  it('get_member 는 username 정확일치 항목을 돌려준다(비활성 포함·ALL 로 조회)', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([
      { userId: 4, username: 'minsu2', name: '김민수2' },
      { userId: 3, username: 'minsu', name: '김민수' },
    ]);
    const out = JSON.parse(await tool(c, 'get_member').handler({ username: 'minsu' }));
    expect(out).toMatchObject({ userId: 3, username: 'minsu' });
    expect(c.searchMembers).toHaveBeenCalledWith({
      search: 'minsu',
      kind: 'ALL',
      includeInactive: true,
      page: 0,
      size: 50,
    });
  });

  it('get_member 는 username 누락을 거부하고, 없는 username 은 안내 문구를 돌려준다', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_member').handler({})).rejects.toThrow();
    const out = await tool(c, 'get_member').handler({ username: 'ghost' });
    expect(out).toContain('찾을 수 없습니다');
  });

  it('get_member_contact 는 응답의 공용 id 를 userId 로 바꿔 모호함을 없앤다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수' }]);
    vi.mocked(c.getMemberContact).mockResolvedValue({ id: 3, title: '팀장', groups: ['팀A'], isFavorite: true });
    const out = JSON.parse(await tool(c, 'get_member_contact').handler({ username: 'minsu' }));
    expect(c.getMemberContact).toHaveBeenCalledWith(3);
    expect(out).toEqual({ userId: 3, title: '팀장', groups: ['팀A'], isFavorite: true });
    expect(out).not.toHaveProperty('id');
  });

  it('get_member_contact 는 groups 가 없으면 [] 로 채운다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수' }]);
    vi.mocked(c.getMemberContact).mockResolvedValue({ id: 3 });
    const out = JSON.parse(await tool(c, 'get_member_contact').handler({ username: 'minsu' }));
    expect(out).toEqual({ userId: 3, groups: [] });
  });

  it('get_member_contact 는 없는 username 이면 연락처를 조회하지 않고 안내 문구를 돌려준다', async () => {
    const c = mockClient();
    const out = await tool(c, 'get_member_contact').handler({ username: 'ghost' });
    expect(out).toContain('찾을 수 없습니다');
    expect(c.getMemberContact).not.toHaveBeenCalled();
  });

  it('list_contacts 는 MEMBER→userId, EXTERNAL→externalId 로 분리하고 공용 id 를 내보내지 않는다', async () => {
    // 두 타입이 같은 숫자 id 를 갖는 상황이 정확히 오용의 원인이었다 — 같은 값으로 검증한다.
    const c = mockClient();
    vi.mocked(c.listContacts).mockResolvedValue({
      items: [
        { id: 7, type: 'MEMBER', name: '김구성원', email: 'm@x.com', title: null, organization: null, isFavorite: false },
        { id: 7, type: 'EXTERNAL', name: '김외부', email: 'e@x.com', title: null, organization: 'X사', isFavorite: true },
      ],
      nextCursor: 'c1',
    });
    const out = JSON.parse(await tool(c, 'list_contacts').handler({ limit: 20 })) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(out.items[0]).toMatchObject({ type: 'MEMBER', userId: 7 });
    expect(out.items[0]).not.toHaveProperty('externalId');
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
    expect(JSON.parse(await tool(c, 'list_contacts').handler({}))).toEqual({ items: [], nextCursor: null });
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
      userId: 1,
    });
  });
});

describe('#833 구성원 해석 (findMemberByUsername)', () => {
  it('조회 오류는 비구성원으로 뭉개지 않고 그대로 전파한다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockRejectedValue({ response: { status: 403 } });
    await expect(findMemberByUsername(c, 'minsu')).rejects.toEqual({ response: { status: 403 } });
    // 도구 경로도 동일 — 안내 문구로 바꾸지 않는다.
    await expect(tool(c, 'get_member').handler({ username: 'minsu' })).rejects.toBeDefined();
  });

  it('부분일치는 채택하지 않는다 — username 정확일치만', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([
      { userId: 7, username: 'minsu2', name: '김민수2', kind: 'HUMAN', active: true },
    ]);
    expect(await findMemberByUsername(c, 'minsu')).toBeUndefined();
    expect(await tool(c, 'get_member').handler({ username: 'minsu' })).toContain('찾을 수 없습니다');
  });
});
