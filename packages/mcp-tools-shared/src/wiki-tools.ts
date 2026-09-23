// src/wiki-tools.ts — 노트(위키) 도구 5종. 두 앱 공유(#846).
// 쓰기는 스페이스 멤버십 가드를 서버가 강제하므로 확인 카드 없이 직접 실행한다.
// update_wiki_page 의 버전 충돌(409)은 그대로 throw — 자동 재시도·머지는 하지 않는다.
import { z } from 'zod';
import type { McpTool } from './mcp-tool.js';
import type { WikiToolClient } from './tool-client.js';

export const searchWikiInput = z.object({ query: z.string().min(1) });
export const getWikiPageInput = z.object({ pageId: z.number().int().positive() });
export const createWikiPageInput = z.object({
  spaceId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  parentId: z.number().int().positive().optional(),
});
// 서버가 부분 수정을 지원한다(title/body 생략 = 현재 값 유지). version 만 필수(낙관적 동시성).
export const updateWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  version: z.number().int().min(1),
  title: z.string().max(255).optional(),
  body: z.string().optional(),
});

/** 노트 도구 5종(list_wiki_spaces/search_wiki/get_wiki_page/create_wiki_page/update_wiki_page). */
export function buildWikiTools(client: WikiToolClient): McpTool[] {
  return [
    {
      name: 'list_wiki_spaces',
      description:
        '내가 접근 가능한 노트 스페이스 목록을 JSON 배열(id·name·type·role)로 반환합니다. 노트를 생성하려면 먼저 이 도구로 대상 스페이스의 id 를 확인하세요. ' +
        '개인 노트는 type="PERSONAL"(이름 "내 노트")입니다. search_wiki 는 페이지 내용만 검색하므로, 스페이스 자체를 찾을 때는 이 도구를 쓰세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listWikiSpaces());
      },
    },
    {
      name: 'search_wiki',
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
      description: '노트 페이지 본문 전체를 JSON(title·body·version 등)으로 반환합니다. search_wiki 결과의 id 로 호출하세요.',
      inputSchema: getWikiPageInput,
      async handler(args) {
        const { pageId } = getWikiPageInput.parse(args);
        return JSON.stringify(await client.getWikiPage(pageId));
      },
    },
    {
      name: 'create_wiki_page',
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
      description:
        '노트 페이지 제목·본문을 저장합니다. 바꿀 필드만 넣으면 나머지는 유지됩니다. version 은 반드시 get_wiki_page 로 읽은 현재 version 을 넣어야 합니다(낙관적 동시성). ' +
        '충돌(409)이면 다시 읽고 재시도 여부를 사용자에게 확인하세요.',
      inputSchema: updateWikiPageInput,
      async handler(args) {
        const { pageId, ...body } = updateWikiPageInput.parse(args);
        return JSON.stringify(await client.updateWikiPage(pageId, body));
      },
    },
  ];
}
