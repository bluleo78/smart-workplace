// src/help-tools.ts — 제품 매뉴얼(도움말) 도구(WP-1510). 두 앱 공유.
// 외부 MCP 도구 정의 크기 상한(tool-naming.test.ts) 때문에 검색과 절 읽기를 도구 둘이 아니라 하나(manual, action 인자)로 합쳤다.
// 관리자 전용 장은 서버가 호출자 역할로 가린다 — 도구는 따로 거르지 않는다(검색에서 빠지고, 절 조회는 404 가 그대로 오류가 된다).
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import type { HelpToolClient } from './tool-client.js';

/**
 * manual 입력 — search 는 query, get 은 id 가 필요하다.
 * query·id 는 앞뒤 공백을 떼고 나서 1자 이상이어야 한다 — 공백만인 값이 빈 검색·`/sections/%20` 조회로 새지 않게(trim 은 도구 정의 JSON 에 드러나지 않아 크기가 그대로다).
 * 서버 레이어가 shape 를 등록하므로 superRefine 뒤에도 z.object 다(notify-tools 의 markNotificationReadInput 과 같음) — 동작별 필수 인자는 핸들러의 parse 가 확인한다.
 */
export const manualInput = z
  .object({
    action: z.enum(['search', 'get']),
    query: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'search' && v.query == null) ctx.addIssue({ code: 'custom', path: ['query'], message: 'search 에는 query 가 필요합니다.' });
    if (v.action === 'get' && v.id == null) ctx.addIssue({ code: 'custom', path: ['id'], message: 'get 에는 id 가 필요합니다.' });
  });

/** 매뉴얼 도구 — 검색 결과는 다음 호출(get)에 쓸 id 와 읽을 거리(path·title·summary)만 남기고, 절 조회는 API 응답을 그대로 넘긴다. */
export function buildHelpTools(client: HelpToolClient): SharedTool[] {
  return [
    {
      name: 'manual',
      app: 'help',
      kind: 'read',
      description:
        'Product manual (how to use Gen:iA Works). search + query: {results:[{id, path, title, summary}]}; ' +
        'get + id: that section {markdown, figures, links}.',
      inputSchema: manualInput,
      async handler(args) {
        const input = manualInput.parse(args);
        if (input.action === 'search') {
          const { results } = await client.searchManual(input.query!);
          // id 는 get 에 넘길 값(API 의 sectionId), summary 는 API 의 snippet — 장·label·mode 는 path 와 겹치거나 모델에 쓸모가 없어 뺀다.
          return JSON.stringify({ results: (results ?? []).map((r) => ({ id: r.sectionId, path: r.path, title: r.title, summary: r.snippet })) });
        }
        return JSON.stringify(await client.getManualSection(input.id!));
      },
    },
  ];
}
