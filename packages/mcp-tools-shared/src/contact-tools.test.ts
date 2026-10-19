import { describe, expect, it, vi } from 'vitest';
import { buildContactTools, resolveContactTarget, toUserGroupDetailView } from './contact-tools.js';
import type { ContactToolClient, MemberToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

type Client = ContactToolClient & Pick<MemberToolClient, 'searchMembers'>;

/** 연락처 부가 기능 클라이언트 mock — 구성원 minsu(userId 3)만 존재. */
function mockClient(): Client {
  return {
    searchMembers: vi.fn().mockResolvedValue([{ userId: 3, username: 'minsu', name: '김민수' }]),
    getContactFacets: vi.fn().mockResolvedValue({ organizations: ['Acme'], titles: ['대표'] }),
    addContactFavorite: vi.fn().mockResolvedValue(undefined),
    removeContactFavorite: vi.fn().mockResolvedValue(undefined),
    listUserGroups: vi.fn().mockResolvedValue({ shared: [], personal: [] }),
    getUserGroup: vi.fn().mockResolvedValue({
      id: 10,
      name: '영업팀',
      code: 'SALES',
      parentId: 2,
      ownerId: null,
      visibility: 'SHARED',
      sortOrder: 5,
      members: [],
    }),
    createUserGroup: vi.fn().mockResolvedValue({ id: 11, name: '새 그룹', visibility: 'PERSONAL', ownerId: 3 }),
    updateUserGroup: vi.fn().mockResolvedValue({ id: 10, name: '영업1팀', visibility: 'SHARED' }),
    addUserGroupMember: vi.fn().mockResolvedValue({ id: 10, name: '영업팀', visibility: 'SHARED', members: [] }),
    removeUserGroupMember: vi.fn().mockResolvedValue(undefined),
    createExternalContact: vi.fn().mockResolvedValue({ id: 3, name: '김거래' }),
    updateExternalContact: vi.fn().mockResolvedValue({ id: 9, name: '김거래' }),
  };
}

const tool = (c: Client, name: string) => buildContactTools(c).find((x) => x.name === name)!;

describe('buildContactTools (#839)', () => {
  it('11종을 등급과 함께 노출하고 그룹 삭제(파괴적)는 두지 않는다', () => {
    const kinds = Object.fromEntries(buildContactTools(mockClient()).map((t) => [t.name, t.kind]));
    expect(kinds).toEqual({
      get_contact_facets: 'read',
      add_contact_favorite: 'write',
      remove_contact_favorite: 'write',
      list_user_groups: 'read',
      get_user_group: 'read',
      create_user_group: 'write',
      update_user_group: 'write',
      add_user_group_member: 'write',
      remove_user_group_member: 'write',
      create_external_contact: 'write',
      update_external_contact: 'write',
    });
  });

  it('get_contact_facets 는 서버 facets 를 그대로 돌려준다', async () => {
    const c = mockClient();
    expect(JSON.parse(resultText(await tool(c, 'get_contact_facets').handler({})))).toEqual({
      organizations: ['Acme'],
      titles: ['대표'],
    });
  });

  it('add_contact_favorite 는 username 을 MEMBER user id 로 해석한다', async () => {
    const c = mockClient();
    await tool(c, 'add_contact_favorite').handler({ username: 'minsu' });
    expect(c.addContactFavorite).toHaveBeenCalledWith({ targetType: 'MEMBER', targetId: 3 });
  });

  it('remove_contact_favorite 는 externalId 를 EXTERNAL 대상으로 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'remove_contact_favorite').handler({ externalId: 9 });
    expect(c.removeContactFavorite).toHaveBeenCalledWith({ targetType: 'EXTERNAL', targetId: 9 });
    expect(c.searchMembers).not.toHaveBeenCalled();
  });

  it('username·externalId 는 정확히 하나여야 한다(둘 다/둘 다 없음 거절)', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_contact_favorite').handler({})).rejects.toThrow('정확히 하나');
    await expect(tool(c, 'add_contact_favorite').handler({ username: 'minsu', externalId: 1 })).rejects.toThrow(
      '정확히 하나',
    );
    expect(c.addContactFavorite).not.toHaveBeenCalled();
  });

  it('없는 username 이면 호출하지 않고 search_members 안내와 함께 throw 한다(isError 로 LLM 에 전달)', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_user_group_member').handler({ groupId: 10, username: 'ghost' })).rejects.toThrow(
      /'ghost' 을\(를\) 찾을 수 없습니다.*search_members/,
    );
    expect(c.addUserGroupMember).not.toHaveBeenCalled();
  });

  it('list_user_groups 는 ownerId·parentId 를 빼고 groupId 로 명명한 트리를 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.listUserGroups).mockResolvedValue({
      shared: [
        {
          id: 1,
          name: '본사',
          parentId: null,
          ownerId: null,
          visibility: 'SHARED',
          children: [{ id: 2, name: '영업', parentId: 1, visibility: 'SHARED', children: [] }],
        },
      ],
      personal: [{ id: 5, name: '내 그룹', ownerId: 3, visibility: 'PERSONAL' }],
    });
    const out = JSON.parse(resultText(await tool(c, 'list_user_groups').handler({})));
    expect(out).toEqual({
      shared: [
        {
          groupId: 1,
          name: '본사',
          code: null,
          visibility: 'SHARED',
          children: [{ groupId: 2, name: '영업', code: null, visibility: 'SHARED', children: [] }],
        },
      ],
      personal: [{ groupId: 5, name: '내 그룹', code: null, visibility: 'PERSONAL', children: [] }],
    });
    expect(JSON.stringify(out)).not.toContain('ownerId');
  });

  it('get_user_group 멤버는 구성원=username, 외부=externalId 로만 표시한다(숫자 user id 비노출)', async () => {
    const view = toUserGroupDetailView({
      id: 10,
      name: '영업팀',
      ownerId: 3,
      visibility: 'PERSONAL',
      members: [
        { targetType: 'MEMBER', targetId: 3, name: '김민수', username: 'minsu' },
        { targetType: 'EXTERNAL', targetId: 9, name: '거래처', organization: 'Acme' },
      ],
    });
    expect(view.members).toEqual([
      { type: 'MEMBER', name: '김민수', email: null, title: null, username: 'minsu' },
      { type: 'EXTERNAL', name: '거래처', email: null, title: null, externalId: 9, organization: 'Acme' },
    ]);
    expect(view).not.toHaveProperty('ownerId');
    expect(JSON.stringify(view.members[0])).not.toContain('targetId');
  });

  it('create_user_group 은 visibility 기본 PERSONAL, parentGroupId → parentId 로 옮긴다', async () => {
    const c = mockClient();
    await tool(c, 'create_user_group').handler({ name: '새 그룹', parentGroupId: 4 });
    expect(c.createUserGroup).toHaveBeenCalledWith({ name: '새 그룹', visibility: 'PERSONAL', parentId: 4 });
  });

  it('update_user_group 은 준 필드만 넘기고 현재 값을 조회하지 않는다(병합은 서버 책임)', async () => {
    const c = mockClient();
    await tool(c, 'update_user_group').handler({ groupId: 10, name: '영업1팀' });
    expect(c.updateUserGroup).toHaveBeenCalledWith(10, { name: '영업1팀' });
    expect(c.getUserGroup).not.toHaveBeenCalled();
  });

  it('update_user_group 은 parentGroupId → parentId, moveToRoot·clearCode 플래그를 그대로 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'update_user_group').handler({ groupId: 10, parentGroupId: 4 });
    expect(c.updateUserGroup).toHaveBeenLastCalledWith(10, { parentId: 4 });
    await tool(c, 'update_user_group').handler({ groupId: 10, moveToRoot: true, clearCode: true });
    expect(c.updateUserGroup).toHaveBeenLastCalledWith(10, { moveToRoot: true, clearCode: true });
  });

  it('update_user_group 은 바꿀 필드가 없으면 호출하지 않고 거절한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'update_user_group').handler({ groupId: 10 })).rejects.toThrow('하나 이상');
    expect(c.updateUserGroup).not.toHaveBeenCalled();
  });

  it('add/remove_user_group_member 는 해석한 대상으로 호출한다', async () => {
    const c = mockClient();
    await tool(c, 'add_user_group_member').handler({ groupId: 10, username: 'minsu' });
    expect(c.addUserGroupMember).toHaveBeenCalledWith(10, { targetType: 'MEMBER', targetId: 3 });
    const out = JSON.parse(resultText(await tool(c, 'remove_user_group_member').handler({ groupId: 10, externalId: 9 })));
    expect(c.removeUserGroupMember).toHaveBeenCalledWith(10, { targetType: 'EXTERNAL', targetId: 9 });
    expect(out).toEqual({ groupId: 10, removed: true });
  });

  it('resolveContactTarget 은 username 정확일치만 인정한다(부분일치 오인 방지)', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockResolvedValue([{ userId: 4, username: 'minsu2', name: '김민수2' }]);
    await expect(resolveContactTarget(c, { username: 'minsu' })).rejects.toThrow('찾을 수 없습니다');
  });
});

describe('외부 연락처 쓰기 (#333 M3, #839, WP-343)', () => {
  it('create_external_contact → force 는 본문이 아니라 별도 인자로 넘기고 결과를 JSON 으로 반환', async () => {
    const c = mockClient();
    const input = { name: '김거래', email: 'k@x.com', visibility: 'SHARED' as const };
    const out = await tool(c, 'create_external_contact').handler(input);
    expect(c.createExternalContact).toHaveBeenLastCalledWith(input, undefined);
    expect(JSON.parse(resultText(out))).toEqual({ id: 3, name: '김거래' });
    await tool(c, 'create_external_contact').handler({ ...input, force: true });
    expect(c.createExternalContact).toHaveBeenLastCalledWith(input, true);
  });

  it('create_external_contact → visibility 누락은 스키마가 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'create_external_contact').handler({ name: 'x' })).rejects.toThrow();
    expect(c.createExternalContact).not.toHaveBeenCalled();
  });

  it('update_external_contact → externalId 를 경로 id 로 분리하고 준 필드(부분 수정)·force 만 넘긴다', async () => {
    const c = mockClient();
    await tool(c, 'update_external_contact').handler({ externalId: 9, name: '김거래', visibility: 'PERSONAL' });
    expect(c.updateExternalContact).toHaveBeenLastCalledWith(9, { name: '김거래', visibility: 'PERSONAL' }, undefined);
    await tool(c, 'update_external_contact').handler({ externalId: 9, phone: '010-1', force: true });
    expect(c.updateExternalContact).toHaveBeenLastCalledWith(9, { phone: '010-1' }, true);
  });

  it('외부 연락처 메모는 2000자까지 — 넘으면 스키마가 거부해 호출하지 않는다 (WP-546)', async () => {
    const c = mockClient();
    const notes = '가'.repeat(2001);
    await expect(
      tool(c, 'create_external_contact').handler({ name: '김거래', notes, visibility: 'SHARED' }),
    ).rejects.toThrow();
    await expect(tool(c, 'update_external_contact').handler({ externalId: 9, notes })).rejects.toThrow();
    expect(c.createExternalContact).not.toHaveBeenCalled();
    expect(c.updateExternalContact).not.toHaveBeenCalled();
    await tool(c, 'update_external_contact').handler({ externalId: 9, notes: '가'.repeat(2000) });
    expect(c.updateExternalContact).toHaveBeenCalledTimes(1);
  });

  it('update_external_contact → 바꿀 필드가 없으면 호출하지 않고 거절한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'update_external_contact').handler({ externalId: 9 })).rejects.toThrow('하나 이상');
    await expect(tool(c, 'update_external_contact').handler({ externalId: 9, force: true })).rejects.toThrow('하나 이상');
    expect(c.updateExternalContact).not.toHaveBeenCalled();
  });
});
