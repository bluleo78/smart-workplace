import { describe, expect, it, vi } from 'vitest';
import { mockPatApiClient as mockClient } from './test-support.js';
import { buildWikiTools } from './wiki.js';

describe('buildWikiTools', () => {
  it('search_wiki → client.searchWikiPages(q)', async () => {
    const c = mockClient();
    (c.searchWikiPages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { pageId: 1, title: '가이드' },
    ]);
    const t = buildWikiTools(c).find((x) => x.name === 'search_wiki')!;
    const out = await t.handler({ q: '가이드' });
    expect(c.searchWikiPages).toHaveBeenCalledWith('가이드');
    expect(JSON.parse(out)).toEqual([{ pageId: 1, title: '가이드' }]);
  });

  it('search_wiki 는 q 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildWikiTools(c).find((x) => x.name === 'search_wiki')!;
    await expect(t.handler({})).rejects.toThrow();
    expect(c.searchWikiPages).not.toHaveBeenCalled();
  });

  it('get_wiki_page → client.getWikiPage(pageId)', async () => {
    const c = mockClient();
    (c.getWikiPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      pageId: 1,
      title: '가이드',
      body: '본문',
      version: 3,
    });
    const t = buildWikiTools(c).find((x) => x.name === 'get_wiki_page')!;
    const out = await t.handler({ pageId: 1 });
    expect(c.getWikiPage).toHaveBeenCalledWith(1);
    expect(JSON.parse(out)).toMatchObject({ pageId: 1 });
  });

  it('create_wiki_page → parentId 생략 시 null 로 client.createWikiPage 호출', async () => {
    const c = mockClient();
    (c.createWikiPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      pageId: 2,
      title: '새 페이지',
    });
    const t = buildWikiTools(c).find((x) => x.name === 'create_wiki_page')!;
    const out = await t.handler({ spaceId: 5, title: '새 페이지' });
    expect(c.createWikiPage).toHaveBeenCalledWith(5, { parentId: null, title: '새 페이지' });
    expect(JSON.parse(out)).toMatchObject({ pageId: 2 });
  });

  it('create_wiki_page → parentId 지정 시 그대로 전달', async () => {
    const c = mockClient();
    const t = buildWikiTools(c).find((x) => x.name === 'create_wiki_page')!;
    await t.handler({ spaceId: 5, title: '자식 페이지', parentId: 9 });
    expect(c.createWikiPage).toHaveBeenCalledWith(5, { parentId: 9, title: '자식 페이지' });
  });

  it('create_wiki_page 는 title 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildWikiTools(c).find((x) => x.name === 'create_wiki_page')!;
    await expect(t.handler({ spaceId: 5 })).rejects.toThrow();
    expect(c.createWikiPage).not.toHaveBeenCalled();
  });

  it('update_wiki_page → client.updateWikiPage(pageId, {title,body,version})', async () => {
    const c = mockClient();
    (c.updateWikiPage as ReturnType<typeof vi.fn>).mockResolvedValue({ pageId: 1, version: 4 });
    const t = buildWikiTools(c).find((x) => x.name === 'update_wiki_page')!;
    const out = await t.handler({ pageId: 1, title: '가이드', body: '수정본', version: 3 });
    expect(c.updateWikiPage).toHaveBeenCalledWith(1, {
      title: '가이드',
      body: '수정본',
      version: 3,
    });
    expect(JSON.parse(out)).toMatchObject({ version: 4 });
  });

  it('update_wiki_page 는 버전 충돌(409) 에러를 그대로 전파한다', async () => {
    const c = mockClient();
    (c.updateWikiPage as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('conflict'), { status: 409 }),
    );
    const t = buildWikiTools(c).find((x) => x.name === 'update_wiki_page')!;
    await expect(
      t.handler({ pageId: 1, title: '가이드', body: '수정본', version: 1 }),
    ).rejects.toThrow('conflict');
  });

  it('update_wiki_page 는 version 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildWikiTools(c).find((x) => x.name === 'update_wiki_page')!;
    await expect(t.handler({ pageId: 1, title: '가이드', body: '수정본' })).rejects.toThrow();
    expect(c.updateWikiPage).not.toHaveBeenCalled();
  });
});
