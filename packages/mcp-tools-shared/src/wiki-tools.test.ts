import { describe, expect, it, vi } from 'vitest';
import type { WikiToolClient } from './tool-client.js';
import { buildWikiTools, toWikiPageTree } from './wiki-tools.js';
import { resultText } from './mcp-content.js';

/** 노트 클라이언트 전 메서드를 vi.fn() 으로 채운 mock. 개별 테스트에서 필요한 것만 재설정한다. */
function mockClient(): WikiToolClient {
  return {
    listWikiSpaces: vi.fn().mockResolvedValue([{ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' }]),
    searchWikiPages: vi.fn().mockResolvedValue([]),
    getWikiPage: vi.fn().mockResolvedValue({}),
    getWikiPageSummary: vi.fn().mockResolvedValue({}),
    listWikiRevisions: vi.fn().mockResolvedValue({ current: {}, items: [] }),
    restoreWikiRevision: vi.fn().mockResolvedValue({}),
    createWikiPage: vi.fn().mockResolvedValue({}),
    updateWikiPage: vi.fn().mockResolvedValue({}),
    listWikiPages: vi.fn().mockResolvedValue([]),
    getWikiBacklinks: vi.fn().mockResolvedValue([]),
    moveWikiPage: vi.fn().mockResolvedValue(undefined),
  };
}

const tool = (c: WikiToolClient, name: string) => buildWikiTools(c).find((x) => x.name === name)!;

describe('buildWikiTools', () => {
  it('정확히 9종을 반환한다', () => {
    expect(buildWikiTools(mockClient()).map((t) => t.name).sort()).toEqual(
      [
        'create_wiki_page',
        'list_wiki_backlinks',
        'get_wiki_page',
        'list_wiki_pages',
        'list_wiki_spaces',
        'move_wiki_page',
        'restore_wiki_revision',
        'search_wiki',
        'update_wiki_page',
      ].sort(),
    );
  });

  it('list_wiki_spaces → client.listWikiSpaces() 결과를 그대로 반환', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await tool(c, 'list_wiki_spaces').handler({})));
    expect(c.listWikiSpaces).toHaveBeenCalled();
    expect(out).toEqual([{ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' }]);
  });

  it('search_wiki → client.searchWikiPages(query)', async () => {
    const c = mockClient();
    vi.mocked(c.searchWikiPages).mockResolvedValue([{ id: 7, spaceName: '팀', title: '릴리스', snippet: '배포' }]);
    const out = await tool(c, 'search_wiki').handler({ query: '배포' });
    expect(c.searchWikiPages).toHaveBeenCalledWith('배포', undefined);
    const parsed = JSON.parse(resultText(out));
    expect(parsed.items[0]).toMatchObject({ id: 7, title: '릴리스' });
    expect(parsed).not.toHaveProperty('truncated');
  });

  it('search_wiki → 서버 상한(50건)에 닿으면 truncated 를 알린다 (WP-352)', async () => {
    const c = mockClient();
    vi.mocked(c.searchWikiPages).mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `p${i}` })));
    const parsed = JSON.parse(resultText(await tool(c, 'search_wiki').handler({ query: 'p' })));
    expect(parsed.items).toHaveLength(50);
    expect(parsed.truncated).toBe(true);
    vi.mocked(c.searchWikiPages).mockResolvedValue(Array.from({ length: 49 }, (_, i) => ({ id: i + 1, title: `p${i}` })));
    expect(JSON.parse(resultText(await tool(c, 'search_wiki').handler({ query: 'p' })))).not.toHaveProperty('truncated');
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
    expect(JSON.parse(resultText(out))).toMatchObject({ id: 7, body: '본문' });
  });

  it('WP-357: search_wiki → spaceId 를 클라이언트로 관통한다', async () => {
    const c = mockClient();
    await tool(c, 'search_wiki').handler({ query: '배포', spaceId: 4 });
    expect(c.searchWikiPages).toHaveBeenCalledWith('배포', 4);
  });

  it('WP-357: get_wiki_page 는 옵션이 꺼져 있으면 요약·판 기록을 요청하지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.getWikiPage).mockResolvedValue({ id: 7, body: '본문', version: 3 });
    const out = JSON.parse(resultText(await tool(c, 'get_wiki_page').handler({ pageId: 7 })));
    expect(c.getWikiPageSummary).not.toHaveBeenCalled();
    expect(c.listWikiRevisions).not.toHaveBeenCalled();
    expect(out).toEqual({ id: 7, body: '본문', version: 3 });
  });

  it('WP-357: includeSummary → 저장된 요약을 summary 로 싣고, READY 면 상태 키를 생략한다', async () => {
    const c = mockClient();
    vi.mocked(c.getWikiPage).mockResolvedValue({ id: 7, version: 3 });
    vi.mocked(c.getWikiPageSummary).mockResolvedValue({ summary: '요약문', status: 'READY', summaryVersion: 3, pageVersion: 3, summarizedAt: '2026-10-01T00:00:00Z' });
    const out = JSON.parse(resultText(await tool(c, 'get_wiki_page').handler({ pageId: 7, includeSummary: true })));
    expect(c.getWikiPageSummary).toHaveBeenCalledWith(7);
    expect(out).toEqual({ id: 7, version: 3, summary: '요약문' });
  });

  it('WP-357: includeSummary → STALE 은 요약과 상태를, 요약이 없는 상태(MISSING·TOO_SHORT·UNAVAILABLE)는 상태만 싣는다', async () => {
    const c = mockClient();
    vi.mocked(c.getWikiPageSummary).mockResolvedValue({ summary: '옛 요약', status: 'STALE' });
    expect(JSON.parse(resultText(await tool(c, 'get_wiki_page').handler({ pageId: 7, includeSummary: true })))).toMatchObject({ summary: '옛 요약', summaryStatus: 'STALE' });
    vi.mocked(c.getWikiPageSummary).mockResolvedValue({ summary: null, status: 'TOO_SHORT' });
    const out = JSON.parse(resultText(await tool(c, 'get_wiki_page').handler({ pageId: 7, includeSummary: true })));
    expect(out).toMatchObject({ summaryStatus: 'TOO_SHORT' });
    expect(out).not.toHaveProperty('summary');
  });

  // 서버 WikiRevisionListResponse 모양 — Person 은 {id, name}(숫자 사용자 ID 포함).
  const person = (id: number, name: string) => ({ id, name });
  const revItem = (version: number) => ({
    version, title: `제목${version}`, editedAt: `2026-10-01T00:00:${String(version % 60).padStart(2, '0')}Z`, createdAt: '2026-10-02T00:00:00Z',
    reason: 'SESSION', editors: [person(11, '앨리스'), person(12, '밥')], aiActor: null,
  });

  it('WP-357: includeRevisions → 판마다 편집자 이름만 싣는다(숫자 사용자 ID·적재 시각·판 제목 제외)', async () => {
    const c = mockClient();
    vi.mocked(c.getWikiPage).mockResolvedValue({ id: 7, version: 5 });
    vi.mocked(c.listWikiRevisions).mockResolvedValue({
      current: { version: 5, editedAt: '2026-10-03T00:00:00Z', editors: [person(11, '앨리스')] },
      items: [{ ...revItem(4), reason: 'AI', aiActor: person(13, '캐럴') }, revItem(3)],
    });
    const out = JSON.parse(resultText(await tool(c, 'get_wiki_page').handler({ pageId: 7, includeRevisions: true })));
    expect(c.listWikiRevisions).toHaveBeenCalledWith(7);
    expect(out.revisions).toEqual([
      { version: 4, editedAt: '2026-10-01T00:00:04Z', reason: 'AI', editors: ['앨리스', '밥'], aiActor: '캐럴' },
      { version: 3, editedAt: '2026-10-01T00:00:03Z', reason: 'SESSION', editors: ['앨리스', '밥'] },
    ]);
    expect(out).not.toHaveProperty('revisionsOmitted');
    expect(JSON.stringify(out)).not.toMatch(/"id":1[123]/);
  });

  it('WP-357: includeRevisions → 최근 30건만 싣고 넘치면 빠진 수를 revisionsOmitted 로 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.listWikiRevisions).mockResolvedValue({ current: {}, items: Array.from({ length: 45 }, (_, i) => revItem(45 - i)) });
    const out = JSON.parse(resultText(await tool(c, 'get_wiki_page').handler({ pageId: 7, includeRevisions: true })));
    expect(out.revisions).toHaveLength(30);
    expect(out.revisions[0].version).toBe(45);
    expect(out.revisionsOmitted).toBe(15);
  });

  it('WP-357: restore_wiki_revision → client.restoreWikiRevision(pageId, version) 의 페이지 뷰를 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.restoreWikiRevision).mockResolvedValue({ id: 7, version: 6, body: '복원본', updatedBy: 11 });
    const out = JSON.parse(resultText(await tool(c, 'restore_wiki_revision').handler({ pageId: 7, version: 2 })));
    expect(c.restoreWikiRevision).toHaveBeenCalledWith(7, 2);
    expect(out).toEqual({ id: 7, version: 6, body: '복원본' }); // updatedBy(숫자 사용자 ID)는 제거
  });

  it('WP-357: restore_wiki_revision 은 덮어쓰는 쓰기라 destructive 이고 멱등이 아니며, version 누락·0 을 거부한다', async () => {
    const c = mockClient();
    expect(tool(c, 'restore_wiki_revision')).toMatchObject({ kind: 'write', hints: { destructive: true, idempotent: false } });
    await expect(tool(c, 'restore_wiki_revision').handler({ pageId: 7 })).rejects.toThrow();
    await expect(tool(c, 'restore_wiki_revision').handler({ pageId: 7, version: 0 })).rejects.toThrow();
    expect(c.restoreWikiRevision).not.toHaveBeenCalled();
  });

  it('create_wiki_page → parentId 생략 시 null 로 client.createWikiPage 호출', async () => {
    const c = mockClient();
    vi.mocked(c.createWikiPage).mockResolvedValue({ id: 2, title: '새 페이지' });
    const out = await tool(c, 'create_wiki_page').handler({ spaceId: 5, title: '새 페이지' });
    expect(c.createWikiPage).toHaveBeenCalledWith(5, { parentId: null, title: '새 페이지' });
    expect(JSON.parse(resultText(out))).toMatchObject({ id: 2 });
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
    expect(JSON.parse(resultText(out))).toMatchObject({ version: 4 });
  });

  it('update_wiki_page 는 부분 수정 — title 만 넘기면 body 키가 클라이언트 인자에 없다', async () => {
    // body 가 undefined 로라도 실리면 서버가 본문을 비울 수 있으므로 키 자체가 없어야 한다.
    const c = mockClient();
    await tool(c, 'update_wiki_page').handler({ pageId: 1, title: '제목만', version: 2 });
    const body = vi.mocked(c.updateWikiPage).mock.calls[0][1];
    expect(body).toStrictEqual({ version: 2, title: '제목만' });
    expect(body).not.toHaveProperty('body');
  });

  it('update_wiki_page 는 기준본 만료(409) 에러를 그대로 전파한다', async () => {
    const c = mockClient();
    vi.mocked(c.updateWikiPage).mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
    await expect(tool(c, 'update_wiki_page').handler({ pageId: 1, body: '수정본', version: 1 })).rejects.toThrow(
      'conflict',
    );
  });

  // WP-309: body 는 전체 대체라 모델이 범위 밖 블록을 다시 쓰거나 정규화하면 사람이 쓴 텍스트가 지워진다 — 설명이 이를 막는 문구를 유지해야 한다.
  it('update_wiki_page 설명은 body 전체 대체·범위 밖 블록 원문 복사를 명시한다 (WP-309)', () => {
    const d = tool(mockClient(), 'update_wiki_page').description;
    expect(d).toContain('replaces the whole Markdown document');
    expect(d).toContain('byte-for-byte');
  });

  it('update_wiki_page 는 version 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'update_wiki_page').handler({ pageId: 1, title: '가이드', body: '수정본' })).rejects.toThrow();
    expect(c.updateWikiPage).not.toHaveBeenCalled();
  });

  it('list_wiki_pages → 평면 목록을 position 순 중첩 트리로 조립한다 (#850)', async () => {
    const c = mockClient();
    vi.mocked(c.listWikiPages).mockResolvedValue([
      { id: 3, parentId: 1, title: '회의록 2', position: 2, aiLastUsedAt: null },
      { id: 1, parentId: null, title: '회의록', position: 1, aiLastUsedAt: null },
      { id: 2, parentId: 1, title: '회의록 1', position: 1, aiLastUsedAt: null },
      { id: 4, parentId: null, title: '온보딩', position: 0, aiLastUsedAt: null },
    ]);
    const out = JSON.parse(resultText(await tool(c, 'list_wiki_pages').handler({ spaceId: 9 })));
    expect(c.listWikiPages).toHaveBeenCalledWith(9);
    expect(out).toEqual({
      items: [
        { id: 4, title: '온보딩' },
        { id: 1, title: '회의록', children: [{ id: 2, title: '회의록 1' }, { id: 3, title: '회의록 2' }] },
      ],
      total: 4,
    });
  });

  it('toWikiPageTree 는 부모가 목록에 없는 페이지를 잃지 않고 최상위로 올린다', () => {
    expect(toWikiPageTree([{ id: 7, parentId: 99, title: '고아', position: 0 }]).items).toEqual([{ id: 7, title: '고아' }]);
  });

  /** 루트 1·2 와 각각 자식 3개씩(id 10..12 / 20..22)인 8페이지 트리. */
  const bigRows = () => [
    { id: 1, parentId: null, title: 'r1', position: 0 },
    { id: 2, parentId: null, title: 'r2', position: 1 },
    ...[10, 11, 12].map((id, i) => ({ id, parentId: 1, title: `c${id}`, position: i })),
    ...[20, 21, 22].map((id, i) => ({ id, parentId: 2, title: `c${id}`, position: i })),
  ];

  it('toWikiPageTree 는 상한이 있으면 위쪽 계층부터 담고 잘린 노드에 hiddenChildren 을 붙인다 (WP-352)', () => {
    // 상한 4: 너비 우선이라 r1·r2(1계층)를 먼저 담고 남은 2칸에 2계층 앞쪽(c10·c11)이 든다. 담긴 노드의 부모는 항상 담겨 있어 고아가 없다.
    const { items, total, truncated } = toWikiPageTree(bigRows(), { maxNodes: 4 });
    expect(total).toBe(8);
    expect(truncated).toBe(true);
    expect(items).toEqual([
      { id: 1, title: 'r1', children: [{ id: 10, title: 'c10' }, { id: 11, title: 'c11' }], hiddenChildren: 1 },
      { id: 2, title: 'r2', hiddenChildren: 3 },
    ]);
  });

  it('toWikiPageTree 는 rootId 의 하위만 만들고, 상한 안이면 truncated 가 아니다', () => {
    const { items, total, truncated } = toWikiPageTree(bigRows(), { rootId: 2, maxNodes: 4 });
    expect(items).toEqual([{ id: 20, title: 'c20' }, { id: 21, title: 'c21' }, { id: 22, title: 'c22' }]);
    expect(total).toBe(3);
    expect(truncated).toBe(false);
  });

  it('list_wiki_pages → 500노드를 넘으면 잘라 truncated·total 을 알리고, parentId 로 하위를 펼친다 (WP-352)', async () => {
    const c = mockClient();
    // 루트 1 아래 자식 600개 — 루트 + 자식 499개만 담기고 루트에 hiddenChildren 101.
    const rows = [
      { id: 1, parentId: null, title: 'root', position: 0 },
      ...Array.from({ length: 600 }, (_, i) => ({ id: 100 + i, parentId: 1, title: `c${i}`, position: i })),
    ];
    vi.mocked(c.listWikiPages).mockResolvedValue(rows);
    const out = JSON.parse(resultText(await tool(c, 'list_wiki_pages').handler({ spaceId: 9 })));
    expect(out.truncated).toBe(true);
    expect(out.total).toBe(601);
    expect(out.items[0].children).toHaveLength(499);
    expect(out.items[0].hiddenChildren).toBe(101);
    const sub = JSON.parse(resultText(await tool(c, 'list_wiki_pages').handler({ spaceId: 9, parentId: 1 })));
    expect(sub.items).toHaveLength(500);
    expect(sub.truncated).toBe(true);
    expect(sub.total).toBe(600);
  });

  // WP-352 최종 리뷰: total 은 parentId 를 주면 하위 트리 노드 수고, 한 부모 아래 500 초과 자식은 parentId 로도 못 펼친다.
  it('list_wiki_pages 설명이 total 의 하위 트리 의미와 한 부모 아래 상한 한계를 밝힌다', () => {
    const { description } = tool(mockClient(), 'list_wiki_pages');
    expect(description).toContain('total counts all nodes (under parentId if given)');
    expect(description).toContain('If a parent has too many direct children');
  });

  it('list_wiki_pages 는 스페이스에 없는 parentId 를 오류로 거절한다', async () => {
    const c = mockClient();
    vi.mocked(c.listWikiPages).mockResolvedValue([{ id: 1, parentId: null, title: 'r', position: 0 }]);
    await expect(tool(c, 'list_wiki_pages').handler({ spaceId: 9, parentId: 77 })).rejects.toThrow('parentId 77');
  });

  it('list_wiki_backlinks → client.getWikiBacklinks(pageId)', async () => {
    const c = mockClient();
    vi.mocked(c.getWikiBacklinks).mockResolvedValue([{ pageId: 5, spaceName: '팀', title: '참조', updatedAt: 't' }]);
    const out = await tool(c, 'list_wiki_backlinks').handler({ pageId: 3 });
    expect(c.getWikiBacklinks).toHaveBeenCalledWith(3);
    expect(JSON.parse(resultText(out))).toEqual([{ pageId: 5, spaceName: '팀', title: '참조', updatedAt: 't' }]);
  });
});

describe('move_wiki_page (#854)', () => {
  it('position 생략 시 맨 끝(서버가 형제 수로 자르는 큰 값)으로 보낸다', async () => {
    const c = mockClient();
    await tool(c, 'move_wiki_page').handler({ pageId: 3, parentId: 9 });
    expect(c.moveWikiPage).toHaveBeenCalledWith(3, { parentId: 9, position: 2_147_483_647 });
  });

  it('parentId null=최상위, position 은 그대로', async () => {
    const c = mockClient();
    await tool(c, 'move_wiki_page').handler({ pageId: 3, parentId: null, position: 0 });
    expect(c.moveWikiPage).toHaveBeenCalledWith(3, { parentId: null, position: 0 });
  });

  it('parentId 는 생략할 수 없다 — 생략을 루트로 해석하면 순서만 바꾸려던 호출이 페이지를 끌어올린다', async () => {
    const c = mockClient();
    await expect(tool(c, 'move_wiki_page').handler({ pageId: 3, position: 1 })).rejects.toThrow();
    expect(c.moveWikiPage).not.toHaveBeenCalled();
  });
});
