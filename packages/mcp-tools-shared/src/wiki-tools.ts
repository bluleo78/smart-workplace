// src/wiki-tools.ts — 노트(위키) 도구. 두 앱 공유(#846, #850, #854).
// 쓰기는 스페이스 멤버십 가드를 서버가 강제하므로 확인 카드 없이 직접 실행한다.
// update_wiki_page 의 409(기준본 없음 — 만료·기록 없음·현재보다 새 version)는 그대로 throw — 자동 재시도는 하지 않는다. 동시 편집은 서버가 3-way 병합한다(WP-289).
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import type { WikiPageRow, WikiToolClient } from './tool-client.js';

export const searchWikiInput = z.object({ query: z.string().min(1) });
export const getWikiPageInput = z.object({ pageId: z.number().int().positive() });
export const listWikiPagesInput = z.object({ spaceId: z.number().int().positive() });
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

/** 페이지 트리 노드 — 자식이 없으면 children 을 생략해 응답을 줄인다. */
export interface WikiPageNode {
  id: number;
  title: string;
  children?: WikiPageNode[];
}

/**
 * 평면 페이지 목록(parentId·position) → 중첩 트리. 서버는 평면 목록만 주고, LLM 이 parentId 를 따라가며 계층을
 * 재구성하면 자주 틀리므로 핸들러가 조립한다. 부모가 목록에 없는 페이지(권한·정합성 문제)는 잃지 않게 최상위로 올린다.
 */
export function toWikiPageTree(rows: WikiPageRow[]): WikiPageNode[] {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<number | null, WikiPageRow[]>();
  for (const r of rows) {
    const parent = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(r);
    else byParent.set(parent, [r]);
  }
  const build = (parent: number | null): WikiPageNode[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => a.position - b.position)
      .map(({ id, title }) => {
        const children = build(id);
        return children.length > 0 ? { id, title, children } : { id, title };
      });
  return build(null);
}

/** 노트 도구(list_wiki_spaces/list_wiki_pages/search_wiki/get_wiki_page/get_wiki_backlinks/create_wiki_page/update_wiki_page/move_wiki_page). */
export function buildWikiTools(client: WikiToolClient): SharedTool[] {
  return [
    {
      name: 'list_wiki_spaces',
      kind: 'read',
      description:
        '내가 접근 가능한 노트 스페이스 목록을 JSON 배열(id·name·type·role)로 반환합니다. 노트를 생성하려면 먼저 이 도구로 대상 스페이스의 id 를 확인하세요. ' +
        '개인 노트는 type="PERSONAL"(이름 "내 노트")입니다. search_wiki 는 페이지 내용만 검색하므로, 스페이스 자체를 찾을 때는 이 도구를 쓰세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listWikiSpaces());
      },
    },
    {
      name: 'list_wiki_pages',
      kind: 'read',
      description:
        '노트 스페이스의 페이지 트리를 JSON 배열로 반환합니다. 각 노드는 id·title 과 하위 페이지 children 을 가지며 사이드바 순서대로 정렬됩니다. ' +
        '스페이스 구성을 파악하거나 제목으로 페이지 위치를 찾을 때 쓰세요. spaceId 는 list_wiki_spaces 결과의 id 입니다.',
      inputSchema: listWikiPagesInput,
      async handler(args) {
        const { spaceId } = listWikiPagesInput.parse(args);
        return JSON.stringify(toWikiPageTree(await client.listWikiPages(spaceId)));
      },
    },
    {
      name: 'search_wiki',
      kind: 'read',
      description:
        '노트 페이지를 제목·본문으로 검색합니다. 접근 가능한 스페이스만 대상이며, 결과 JSON 배열(id·spaceName·title·snippet)을 반환합니다. 근거가 필요하면 먼저 검색하세요.',
      inputSchema: searchWikiInput,
      async handler(args) {
        const { query } = searchWikiInput.parse(args);
        return JSON.stringify(await client.searchWikiPages(query));
      },
    },
    {
      name: 'get_wiki_page',
      kind: 'read',
      description: '노트 페이지 본문 전체를 JSON(title·body·version 등)으로 반환합니다. search_wiki 결과의 id 로 호출하세요.',
      inputSchema: getWikiPageInput,
      async handler(args) {
        const { pageId } = getWikiPageInput.parse(args);
        return JSON.stringify(await client.getWikiPage(pageId));
      },
    },
    {
      name: 'get_wiki_backlinks',
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
      kind: 'write',
      description:
        '노트 스페이스에 새 페이지를 생성합니다. parentId 를 주면 그 하위에, 생략하면 최상위에 만듭니다. 생성된 페이지(id·version)를 JSON 으로 반환합니다.',
      inputSchema: createWikiPageInput,
      async handler(args) {
        const { spaceId, title, parentId } = createWikiPageInput.parse(args);
        return JSON.stringify(await client.createWikiPage(spaceId, { parentId: parentId ?? null, title }));
      },
    },
    {
      name: 'update_wiki_page',
      kind: 'write',
      description:
        '노트 페이지 제목·본문을 저장합니다. 바꿀 필드만 넣으면 나머지는 유지됩니다. version 은 get_wiki_page 로 읽었거나 직전 update_wiki_page 응답에서 받은 version 을 넣으세요 — ' +
        '그 사이 다른 사람이 고친 부분은 서버가 자동으로 합칩니다(같은 곳을 함께 고쳤으면 이 요청의 내용이 우선). ' +
        '409 는 그 version 의 기준본을 쓸 수 없는 경우입니다(읽은 지 1시간이 지나 만료·기록 없음·현재보다 새 version) — 오류 문구에 사유가 있습니다. get_wiki_page 로 다시 읽고 최신 본문에 수정을 반영해 다시 저장하세요.',
      inputSchema: updateWikiPageInput,
      async handler(args) {
        const { pageId, ...body } = updateWikiPageInput.parse(args);
        return JSON.stringify(await client.updateWikiPage(pageId, body));
      },
    },
    {
      name: 'move_wiki_page',
      kind: 'write',
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
