// src/wiki-tools.ts — 노트(위키) 도구. 두 앱 공유(#846, #850, #854).
// 쓰기는 스페이스 멤버십 가드를 서버가 강제하므로 확인 카드 없이 직접 실행한다.
// update_wiki_page 의 409(기준본 없음 — 만료·기록 없음·현재보다 새 version)는 그대로 throw — 자동 재시도는 하지 않는다. 동시 편집은 서버가 3-way 병합한다(WP-289).
import { z } from 'zod';
import { omitKeys, truncatedView } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import type { WikiPageRow, WikiToolClient } from './tool-client.js';

export const searchWikiInput = z.object({ query: z.string().min(1) });
export const getWikiPageInput = z.object({ pageId: z.number().int().positive() });
export const listWikiPagesInput = z.object({
  spaceId: z.number().int().positive(),
  // WP-352: 큰 스페이스의 트리가 잘렸을 때 그 페이지의 하위만 따로 펼쳐 보는 용도.
  parentId: z.number().int().positive().optional().describe('Return only the subtree under this page (to expand hiddenChildren)'),
});

/** 한 번에 돌려줄 트리 노드 수 상한 — 넘으면 위쪽 계층부터 이 수만큼만 담고 truncated 로 알린다(수천 페이지 스페이스의 토큰 폭주 방지). */
const MAX_WIKI_TREE_NODES = 500;
/**
 * 서버 노트 검색이 거는 상한(WikiPageService.search 의 pages.search(..., 50), 최근 수정순). 서버가 잘렸는지 알리지 않아
 * 이 수에 닿으면 더 있을 수 있다고 본다. 서버 상한을 바꾸면 이 값도 맞춘다.
 */
const SEARCH_SERVER_CAP = 50;
export const createWikiPageInput = z.object({
  spaceId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  parentId: z.number().int().positive().optional(),
});
// 서버가 부분 수정을 지원한다(title/body 생략 = 현재 값 유지). version 은 병합 기준(읽은 판)이라 필수.
export const updateWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  version: z.number().int().min(1),
  title: z.string().max(255).optional(),
  body: z.string().optional(),
});

// parentId 는 생략이 아닌 명시(null=최상위)로 받는다 — 생략을 루트로 해석하면 위치만 바꾸려던 호출이 페이지를 루트로 끌어올린다.
export const moveWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable(),
  position: z.number().int().min(0).optional(),
});

/** position 생략 시 보낼 값 — 서버가 0..형제수로 잘라 맨 끝에 놓는다(서버 필드가 Integer). */
const APPEND_POSITION = 2_147_483_647;

/**
 * 페이지 트리 노드 — 자식이 없으면 children 을 생략해 응답을 줄인다. hiddenChildren 은 상한 때문에 children 에 못 담은 직계 자식 수
 * (잘린 노드에만 있다 — list_wiki_pages 의 parentId 로 펼친다).
 */
export interface WikiPageNode {
  id: number;
  title: string;
  children?: WikiPageNode[];
  hiddenChildren?: number;
}

/**
 * 평면 페이지 목록(parentId·position) → 중첩 트리. 서버는 평면 목록만 주고, LLM 이 parentId 를 따라가며 계층을
 * 재구성하면 자주 틀리므로 핸들러가 조립한다. 부모가 목록에 없는 페이지(권한·정합성 문제)는 잃지 않게 최상위로 올린다.
 * rootId 를 주면 그 페이지의 하위 트리만 만든다(없는 페이지면 빈 트리).
 * maxNodes 를 주면 위쪽 계층부터 너비 우선으로 그 수만큼만 담는다 — 담긴 노드의 부모는 항상 담겨 있어 계층이 깨지지 않고,
 * 자식이 다 담기지 못한 노드에는 hiddenChildren 이 붙는다. total 은 상한 전의 전체 노드 수다.
 */
export function toWikiPageTree(rows: WikiPageRow[], opts: { rootId?: number; maxNodes?: number } = {}) {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<number | null, WikiPageRow[]>();
  for (const r of rows) {
    const parent = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(r);
    else byParent.set(parent, [r]);
  }
  const childrenOf = (parent: number | null) => (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position);
  const rootParent = opts.rootId ?? null;
  // 너비 우선으로 담을 노드를 고른다 — 상한이 없으면 전부.
  const included = new Set<number>();
  const queue = [...childrenOf(rootParent)];
  const countAll = (parent: number | null): number => childrenOf(parent).reduce((n, c) => n + 1 + countAll(c.id), 0);
  const total = countAll(rootParent);
  for (let i = 0; i < queue.length && included.size < (opts.maxNodes ?? Infinity); i++) {
    included.add(queue[i].id);
    queue.push(...childrenOf(queue[i].id));
  }
  const build = (parent: number | null): WikiPageNode[] =>
    childrenOf(parent)
      .filter((r) => included.has(r.id))
      .map(({ id, title }) => {
        const children = build(id);
        const hidden = childrenOf(id).length - children.length;
        return { id, title, ...(children.length > 0 && { children }), ...(hidden > 0 && { hiddenChildren: hidden }) };
      });
  return { items: build(rootParent), total, truncated: included.size < total };
}

/**
 * 페이지 상세 → LLM 뷰. 마지막 수정자 updatedBy 는 숫자 사용자 ID 라 내보내지 않는다(#833, WP-353).
 * 서버 응답에 수정자 이름이 없고(WikiPageDetail 은 id 만), 수정 시각 updatedAt 으로 "언제" 는 알 수 있다 — 이름을 풀려면 id→사용자
 * 일괄 조회가 필요한데 공유 도구에는 없고(구성원 조회는 검색어 기준), 이 값을 입력으로 받는 도구도 없어 서버 필드를 늘리지 않고 뺀다.
 */
export function toWikiPageView(page: Record<string, unknown>) {
  return omitKeys(page, 'updatedBy');
}

/** 노트 도구(list_wiki_spaces/list_wiki_pages/search_wiki/get_wiki_page/list_wiki_backlinks/create_wiki_page/update_wiki_page/move_wiki_page). */
export function buildWikiTools(client: WikiToolClient): SharedTool[] {
  return [
    {
      name: 'list_wiki_spaces',
      app: 'wiki',
      kind: 'read',
      description:
        'Lists wiki spaces (노트 스페이스) I can access: id (the spaceId of other wiki tools), name, type, role. My personal space is type PERSONAL ("내 ' +
        '노트"). Use it to find a space; search_wiki searches pages only.',
      inputSchema: z.object({}),
      async handler() {
        // 스페이스 소유자 ownerId 는 숫자 사용자 ID 라 내보내지 않는다(#833, WP-353) — 내 역할은 role 로 알 수 있다.
        return JSON.stringify(((await client.listWikiSpaces()) as Record<string, unknown>[]).map((space) => omitKeys(space, 'ownerId')));
      },
    },
    {
      name: 'list_wiki_pages',
      app: 'wiki',
      kind: 'read',
      description:
        'Returns the page tree of a wiki space as {items, total, truncated?}; nodes {id (pageId), title, children?} in sidebar order. Beyond ' +
        `${MAX_WIKI_TREE_NODES} nodes only the top ${MAX_WIKI_TREE_NODES} (breadth-first) come back with truncated:true; nodes with hiddenChildren ` +
        'expand by calling again with their id as parentId. total counts all nodes (under parentId if given). If a parent has too many direct ' +
        'children, use search_wiki. Without expanding, say only part was seen.',
      inputSchema: listWikiPagesInput,
      async handler(args) {
        const { spaceId, parentId } = listWikiPagesInput.parse(args);
        const rows = await client.listWikiPages(spaceId);
        if (parentId !== undefined && !rows.some((r) => r.id === parentId)) {
          throw new Error(`parentId ${parentId} 페이지가 이 스페이스(${spaceId})에 없습니다. list_wiki_pages 트리의 id 를 쓰세요.`);
        }
        const { items, total, truncated } = toWikiPageTree(rows, { rootId: parentId, maxNodes: MAX_WIKI_TREE_NODES });
        return JSON.stringify({ items, total, ...(truncated && { truncated: true }) });
      },
    },
    {
      name: 'search_wiki',
      app: 'wiki',
      kind: 'read',
      description:
        'Searches wiki pages (노트) by title and body substring in spaces I can access, newest edit first: {items {id, spaceName, title, snippet}, ' +
        `truncated?}, at most ${SEARCH_SERVER_CAP}. truncated:true means more may exist and there is no next page: refine the query, or say the ` +
        'result is partial.',
      inputSchema: searchWikiInput,
      async handler(args) {
        const { query } = searchWikiInput.parse(args);
        const rows = (await client.searchWikiPages(query)) as unknown[];
        // 서버가 상한에서 조용히 자르므로 그 수에 닿으면 잘렸을 수 있다고 본다.
        return JSON.stringify(truncatedView(rows, rows.length >= SEARCH_SERVER_CAP));
      },
    },
    {
      name: 'get_wiki_page',
      app: 'wiki',
      kind: 'read',
      description:
        'Returns a wiki page (노트) by pageId (id from search_wiki or list_wiki_pages): Markdown body, version (needed by update_wiki_page), spaceId, ' +
        'parentId.',
      inputSchema: getWikiPageInput,
      async handler(args) {
        const { pageId } = getWikiPageInput.parse(args);
        return JSON.stringify(toWikiPageView((await client.getWikiPage(pageId)) as Record<string, unknown>));
      },
    },
    {
      name: 'list_wiki_backlinks',
      app: 'wiki',
      kind: 'read',
      description:
        'Lists the pages that link to this wiki page (backlinks): {pageId, spaceName, title, updatedAt}, only pages I can see.',
      inputSchema: getWikiPageInput,
      async handler(args) {
        const { pageId } = getWikiPageInput.parse(args);
        return JSON.stringify(await client.getWikiBacklinks(pageId));
      },
    },
    {
      name: 'create_wiki_page',
      app: 'wiki',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Creates an empty wiki page (노트) in spaceId (from list_wiki_spaces), under parentId or at the top level. Returns it with id and version; ' +
        'write the body with update_wiki_page.',
      inputSchema: createWikiPageInput,
      async handler(args) {
        const { spaceId, title, parentId } = createWikiPageInput.parse(args);
        return JSON.stringify(toWikiPageView((await client.createWikiPage(spaceId, { parentId: parentId ?? null, title })) as Record<string, unknown>));
      },
    },
    {
      name: 'update_wiki_page',
      app: 'wiki',
      kind: 'write',
      // 본문 전체 대체(3-way 병합). AI 적용은 매번 이전 판 스냅샷을 남기고, 기준본이 만료되면 409 라 멱등으로 보지 않는다.
      hints: { destructive: true, idempotent: false },
      description:
        'Saves a wiki page (노트) title and/or body; omitted fields stay. body replaces the whole Markdown document and anything left out is deleted, ' +
        'so for a partial edit send the full body, copying untouched blocks byte-for-byte from get_wiki_page (no rewording, no whitespace, list, ' +
        'emphasis or heading normalization). version: from get_wiki_page or the last update_wiki_page result; edits by others since then are merged ' +
        '(this request wins on overlap). 409: that version is unusable as the base (read over 1 hour ago, unknown, or newer than current); re-read ' +
        'and reapply.',
      inputSchema: updateWikiPageInput,
      async handler(args) {
        const { pageId, ...body } = updateWikiPageInput.parse(args);
        return JSON.stringify(toWikiPageView((await client.updateWikiPage(pageId, body)) as Record<string, unknown>));
      },
    },
    {
      name: 'move_wiki_page',
      app: 'wiki',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Moves a wiki page with its subpages inside its space. parentId: new parent pageId, or null for the top level. position: index among the new ' +
        'siblings (0 = first, omit = last). Cannot move to another space or under itself.',
      inputSchema: moveWikiPageInput,
      async handler(args) {
        const { pageId, parentId, position } = moveWikiPageInput.parse(args);
        await client.moveWikiPage(pageId, { parentId, position: position ?? APPEND_POSITION });
        return 'ok';
      },
    },
  ];
}
