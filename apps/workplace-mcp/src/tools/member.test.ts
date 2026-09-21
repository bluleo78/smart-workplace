import { describe, expect, it, vi } from 'vitest';
import { buildMemberTools } from './member.js';
import { mockPatApiClient as mockClient } from './test-support.js';

describe('buildMemberTools (#833)', () => {
  const find = (c: ReturnType<typeof mockClient>, name: string) =>
    buildMemberTools(c).find((x) => x.name === name)!;

  it('search_members → client.searchMembers(params), kind 기본값 HUMAN', async () => {
    const c = mockClient();
    (c.searchMembers as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 3, name: '김민수' }]);
    const out = await find(c, 'search_members').handler({ search: '김' });
    expect(c.searchMembers).toHaveBeenCalledWith({ search: '김', kind: 'HUMAN', page: 0, size: 20 });
    expect(JSON.parse(out)).toEqual([{ id: 3, name: '김민수' }]);
  });

  it('get_member 는 username 정확일치 항목을 돌려준다', async () => {
    const c = mockClient();
    (c.searchMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { userId: 3, username: 'minsu', name: '김민수' },
      { userId: 4, username: 'minsu2', name: '김민수2' },
    ]);
    const out = JSON.parse(await find(c, 'get_member').handler({ username: 'minsu' }));
    expect(out).toMatchObject({ userId: 3, username: 'minsu' });
  });

  it('get_member_contact 는 응답의 공용 id 를 userId 로 바꿔 모호함을 없앤다', async () => {
    // ai-agent 쪽 동일 도구와 필드명이 갈리면, 이 변경이 없애려던 id 혼동이 PAT 경로에서만 되살아난다.
    const c = mockClient();
    (c.searchMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { userId: 3, username: 'minsu', name: '김민수' },
    ]);
    (c.getMemberContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 3, groups: ['팀A'] });
    const out = JSON.parse(await find(c, 'get_member_contact').handler({ username: 'minsu' }));
    expect(c.getMemberContact).toHaveBeenCalledWith(3);
    expect(out).toMatchObject({ userId: 3, groups: ['팀A'] });
    expect(out).not.toHaveProperty('id');
  });

  it('get_member 는 username 누락을 거부하고, 없는 username 은 안내 문구를 돌려준다', async () => {
    const c = mockClient();
    await expect(find(c, 'get_member').handler({})).rejects.toThrow();
    (c.searchMembers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await find(c, 'get_member').handler({ username: 'ghost' });
    expect(out).toContain('찾을 수 없습니다');
  });

  it('list_contacts 는 MEMBER→userId, EXTERNAL→externalId 로 분리하고 공용 id 를 내보내지 않는다', async () => {
    // 두 타입이 같은 숫자 id 를 갖는 상황이 정확히 오용의 원인이었다 — 같은 값으로 검증한다.
    const c = mockClient();
    (c.listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        { id: 9, type: 'MEMBER', name: '사내', email: null, title: null, organization: null, isFavorite: false },
        { id: 9, type: 'EXTERNAL', name: '사외', email: null, title: null, organization: null, isFavorite: false },
      ],
      nextCursor: null,
    });
    const out = JSON.parse(await find(c, 'list_contacts').handler({})) as {
      items: Record<string, unknown>[];
    };
    expect(out.items[0]).toMatchObject({ type: 'MEMBER', userId: 9 });
    expect(out.items[0]).not.toHaveProperty('id');
    expect(out.items[1]).toMatchObject({ type: 'EXTERNAL', externalId: 9 });
    expect(out.items[1]).not.toHaveProperty('id');
  });

  it('get_external_contact 는 externalId 를 받는다 — userId 키는 거부', async () => {
    const c = mockClient();
    (c.getExternalContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 5 });
    await find(c, 'get_external_contact').handler({ externalId: 5 });
    expect(c.getExternalContact).toHaveBeenCalledWith(5);
    await expect(find(c, 'get_external_contact').handler({ userId: 5 })).rejects.toThrow();
  });

  it('쓰기 도구는 노출하지 않는다 — PAT 컨텍스트에는 확인 카드가 없다', () => {
    const names = buildMemberTools(mockClient()).map((t) => t.name);
    expect(names.some((n) => n.startsWith('propose_'))).toBe(false);
    expect(names).not.toContain('create_member');
    expect(names).not.toContain('set_member_role');
  });
});
