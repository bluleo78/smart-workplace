// src/tools/wiki.ts — 위키 도메인 도구. 검색/조회는 읽기, 생성/수정은 쓰기(낙관적 동시성)다.
// update_wiki_page 의 버전 충돌(409)은 그대로 throw 되어 MCP 호스트에 에러로 전파된다
// (자동 재시도·머지는 하지 않음 — 사용자가 최신 버전을 다시 조회해 재시도해야 함).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 위키 도메인 도구 4종(search_wiki/get_wiki_page/create_wiki_page/update_wiki_page) 을 구성한다. */
export function buildWikiTools(client: PatApiClient): McpTool[] {
  const searchWikiInput = z.object({ q: z.string().min(1) });
  const getWikiPageInput = z.object({ pageId: z.number().int() });
  const createWikiPageInput = z.object({
    spaceId: z.number().int(),
    title: z.string().min(1),
    parentId: z.number().int().nullable().optional(),
  });
  const updateWikiPageInput = z.object({
    pageId: z.number().int(),
    title: z.string().min(1),
    body: z.string(),
    version: z.number().int(),
  });

  return [
    {
      name: 'search_wiki',
      description: '검색어로 위키 페이지를 검색해 JSON 목록으로 반환합니다.',
      inputSchema: searchWikiInput,
      async handler(args) {
        const { q } = searchWikiInput.parse(args);
        return JSON.stringify(await client.searchWikiPages(q));
      },
    },
    {
      name: 'get_wiki_page',
      description: '위키 페이지 본문·버전을 JSON 으로 반환합니다.',
      inputSchema: getWikiPageInput,
      async handler(args) {
        const { pageId } = getWikiPageInput.parse(args);
        return JSON.stringify(await client.getWikiPage(pageId));
      },
    },
    {
      name: 'create_wiki_page',
      description: '스페이스에 새 위키 페이지를 생성합니다. parentId 생략 시 최상위에 생성됩니다.',
      inputSchema: createWikiPageInput,
      async handler(args) {
        const { spaceId, title, parentId } = createWikiPageInput.parse(args);
        return JSON.stringify(
          await client.createWikiPage(spaceId, { parentId: parentId ?? null, title }),
        );
      },
    },
    {
      name: 'update_wiki_page',
      description:
        '위키 페이지를 수정합니다(낙관적 동시성). version 이 최신이 아니면 409 오류가 발생합니다.',
      inputSchema: updateWikiPageInput,
      async handler(args) {
        const { pageId, title, body, version } = updateWikiPageInput.parse(args);
        return JSON.stringify(await client.updateWikiPage(pageId, { title, body, version }));
      },
    },
  ];
}
