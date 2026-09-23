import { describe, expect, it, vi } from 'vitest';
import type { WikiToolClient } from './tool-client.js';
import { buildWikiTools } from './wiki-tools.js';

/** 노트 클라이언트 전 메서드를 vi.fn() 으로 채운 mock. 개별 테스트에서 필요한 것만 재설정한다. */
function mockClient(): WikiToolClient {
  return {
    listWikiSpaces: vi.fn().mockResolvedValue([{ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' }]),
    searchWikiPages: vi.fn().mockResolvedValue([]),
    getWikiPage: vi.fn().mockResolvedValue({}),
    createWikiPage: vi.fn().mockResolvedValue({}),
    updateWikiPage: vi.fn().mockResolvedValue({}),
  };
}

const tool = (c: WikiToolClient, name: string) => buildWikiTools(c).find((x) => x.name === name)!;

describe('buildWikiTools', () => {
  it('정확히 5종을 반환한다', () => {
    expect(buildWikiTools(mockClient()).map((t) => t.name).sort()).toEqual(
      ['create_wiki_page', 'get_wiki_page', 'list_wiki_spaces', 'search_wiki', 'update_wiki_page'].sort(),
    );
  });

  it('list_wiki_spaces → client.listWikiSpaces() 결과를 그대로 반환', async () => {
    const c = mockClient();
    const out = JSON.parse(await tool(c, 'list_wiki_spaces').handler({}));
    expect(c.listWikiSpaces).toHaveBeenCalled();
    expect(out).toEqual([{ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' }]);
  });

  it('search_wiki → client.searchWikiPages(query)', async () => {
    const c = mockClient();
    vi.mocked(c.searchWikiPages).mockResolvedValue([{ id: 7, spaceName: '팀', title: '릴리스', snippet: '배포' }]);
    const out = await tool(c, 'search_wiki').handler({ query: '배포' });
    expect(c.searchWikiPages).toHaveBeenCalledWith('배포');
    expect(JSON.parse(out)[0]).toMatchObject({ id: 7, title: '릴리스' });
  });

  it('search_wiki 는 query 누락(옛 파라미터 q 포함) 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'search_wiki').handler({})).rejects.toThrow();
    await expect(tool(c, 'search_wiki').handler({ q: '가이드' })).rejects.toThrow();
    expect(c.searchWikiPages).not.toHaveBeenCalled();
  });

  it('get_wiki_page → client.getWikiPage(pageId)', async () => {
    const c = mockClient();
    vi.mocked(c.getWikiPage).mockResolvedValue({ id: 7, title: '릴리스', body: '본문', version: 3 });
    const out = await tool(c, 'get_wiki_page').handler({ pageId: 7 });
    expect(c.getWikiPage).toHaveBeenCalledWith(7);
    expect(JSON.parse(out)).toMatchObject({ id: 7, body: '본문' });
  });

  it('create_wiki_page → parentId 생략 시 null 로 client.createWikiPage 호출', async () => {
    const c = mockClient();
    vi.mocked(c.createWikiPage).mockResolvedValue({ id: 2, title: '새 페이지' });
    const out = await tool(c, 'create_wiki_page').handler({ spaceId: 5, title: '새 페이지' });
    expect(c.createWikiPage).toHaveBeenCalledWith(5, { parentId: null, title: '새 페이지' });
    expect(JSON.parse(out)).toMatchObject({ id: 2 });
  });

  it('create_wiki_page → parentId 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'create_wiki_page').handler({ spaceId: 5, title: '자식 페이지', parentId: 9 });
    expect(c.createWikiPage).toHaveBeenCalledWith(5, { parentId: 9, title: '자식 페이지' });
  });

  it('create_wiki_page 는 title 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'create_wiki_page').handler({ spaceId: 5 })).rejects.toThrow();
    expect(c.createWikiPage).not.toHaveBeenCalled();
  });

  it('update_wiki_page → client.updateWikiPage(pageId, {version,title,body})', async () => {
    const c = mockClient();
    vi.mocked(c.updateWikiPage).mockResolvedValue({ id: 1, version: 4 });
    const out = await tool(c, 'update_wiki_page').handler({ pageId: 1, title: '가이드', body: '수정본', version: 3 });
    expect(vi.mocked(c.updateWikiPage).mock.calls[0]).toStrictEqual([1, { version: 3, title: '가이드', body: '수정본' }]);
    expect(JSON.parse(out)).toMatchObject({ version: 4 });
  });

  it('update_wiki_page 는 부분 수정 — title 만 넘기면 body 키가 클라이언트 인자에 없다', async () => {
    // body 가 undefined 로라도 실리면 서버가 본문을 비울 수 있으므로 키 자체가 없어야 한다.
    const c = mockClient();
    await tool(c, 'update_wiki_page').handler({ pageId: 1, title: '제목만', version: 2 });
    const body = vi.mocked(c.updateWikiPage).mock.calls[0][1];
    expect(body).toStrictEqual({ version: 2, title: '제목만' });
    expect(body).not.toHaveProperty('body');
  });

  it('update_wiki_page 는 버전 충돌(409) 에러를 그대로 전파한다', async () => {
    const c = mockClient();
    vi.mocked(c.updateWikiPage).mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
    await expect(tool(c, 'update_wiki_page').handler({ pageId: 1, body: '수정본', version: 1 })).rejects.toThrow(
      'conflict',
    );
  });

  it('update_wiki_page 는 version 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'update_wiki_page').handler({ pageId: 1, title: '가이드', body: '수정본' })).rejects.toThrow();
    expect(c.updateWikiPage).not.toHaveBeenCalled();
  });
});
