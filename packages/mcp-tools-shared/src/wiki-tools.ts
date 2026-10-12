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
  parentId: z.number().int().positive().optional().describe('이 페이지의 하위 트리만 — 잘린 노드(hiddenChildren)를 펼칠 때'),
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
        '내가 접근 가능한 노트 스페이스 목록을 JSON 배열(id·name·type·role)로 반환합니다. 노트를 생성하려면 먼저 이 도구로 대상 스페이스의 id 를 확인하세요. ' +
        '개인 노트는 type="PERSONAL"(이름 "내 노트")입니다. search_wiki 는 페이지 내용만 검색하므로, 스페이스 자체를 찾을 때는 이 도구를 쓰세요.',
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
        '노트 스페이스의 페이지 트리를 JSON({items, total, truncated?})으로 반환합니다. items 의 각 노드는 id·title 과 하위 페이지 children 을 가지며 사이드바 순서대로 정렬됩니다. ' +
        '스페이스 구성을 파악하거나 제목으로 페이지 위치를 찾을 때 쓰세요. spaceId 는 list_wiki_spaces 결과의 id 입니다. ' +
        `total 은 전체 페이지 수(parentId 를 주면 그 아래 하위 트리의 노드 수)이고, 담을 노드가 ${MAX_WIKI_TREE_NODES}개를 넘으면 위쪽 계층부터 ${MAX_WIKI_TREE_NODES}개만 담고 truncated:true 가 옵니다. ` +
        '이때 하위가 다 담기지 못한 노드에는 hiddenChildren(못 담은 직계 자식 수)이 붙으니, 그 노드의 id 를 parentId 로 다시 호출해 하위를 펼치세요. ' +
        '한 부모 바로 아래 자식이 한 번에 담을 수 있는 수를 넘으면 parentId 로도 다 펼칠 수 없으니 그때는 search_wiki 로 찾으세요. 특정 제목은 search_wiki 가 빠릅니다. 펼치지 않고 답한다면 일부 계층만 본 것이라고 밝히세요(개수 집계·"없다" 단정 금지). truncated 가 없으면 전부 담긴 것입니다.',
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
        '노트 페이지를 제목·본문으로 검색합니다. 접근 가능한 스페이스만 대상이며, 결과 JSON({items, truncated?})의 items 는 최근 수정순 최대 ' +
        `${SEARCH_SERVER_CAP}건(id·spaceName·title·snippet)입니다. 더 있을 수 있으면 truncated:true 가 옵니다 — 이어 조회하는 방법은 없으니 검색어를 더 구체적으로 바꿔 다시 검색하거나, ` +
        '그대로 답한다면 일부만 본 것이라고 밝히세요(개수 집계 금지). 근거가 필요하면 먼저 검색하세요.',
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
      description: '노트 페이지 본문 전체를 JSON(title·body·version 등)으로 반환합니다. search_wiki 결과의 id 로 호출하세요.',
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
        '이 노트 페이지를 링크한 다른 페이지 목록(백링크)을 JSON 배열(pageId·spaceName·title·updatedAt)로 반환합니다. 내가 볼 수 있는 페이지만 포함됩니다.',
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
        '노트 스페이스에 새 페이지를 생성합니다. parentId 를 주면 그 하위에, 생략하면 최상위에 만듭니다. 생성된 페이지(id·version)를 JSON 으로 반환합니다.',
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
        '노트 페이지 제목·본문을 저장합니다. title·body 중 바꿀 필드만 넣으면 넣지 않은 필드는 유지됩니다. ' +
        'body 는 문서 전체를 대체합니다 — body 에서 빠진 텍스트는 삭제됩니다. 일부만 고칠 때도 읽은 본문 전체를 넣되, 요청 범위 밖 블록은 get_wiki_page 로 읽은 그대로 바이트 단위로 복사하세요: ' +
        '다시 쓰기·공백/빈 줄/목록 기호/강조·제목 표기 정규화·요청받지 않은 텍스트 삭제 금지. version 은 get_wiki_page 로 읽었거나 직전 update_wiki_page 응답에서 받은 version 을 넣으세요 — ' +
        '그 사이 다른 사람이 고친 부분은 서버가 자동으로 합칩니다(같은 곳을 함께 고쳤으면 이 요청의 내용이 우선). ' +
        '409 는 그 version 의 기준본을 쓸 수 없는 경우입니다(읽은 지 1시간이 지나 만료·기록 없음·현재보다 새 version) — 오류 문구에 사유가 있습니다. get_wiki_page 로 다시 읽고 최신 본문에 수정을 반영해 다시 저장하세요.',
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
        '노트 페이지를 같은 스페이스 안에서 옮깁니다(하위 페이지도 함께). parentId 는 새 부모 페이지 id(null=최상위), ' +
        'position 은 새 부모 아래 순서(0=맨 앞, 생략=맨 끝)입니다. id 는 list_wiki_pages 트리에서 확인하세요. 다른 스페이스나 자기 하위로는 옮길 수 없습니다.',
      inputSchema: moveWikiPageInput,
      async handler(args) {
        const { pageId, parentId, position } = moveWikiPageInput.parse(args);
        await client.moveWikiPage(pageId, { parentId, position: position ?? APPEND_POSITION });
        return 'ok';
      },
    },
  ];
}
