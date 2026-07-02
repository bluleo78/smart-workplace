// src/tools/drive.ts — 드라이브 도메인 도구. 읽기 전용이다(파일 업로드/이동/삭제는 후속 태스크 —
// PAT 경유 대용량 바이너리 전송·파일시스템 부수효과는 이번 슬라이스 범위 밖).
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 드라이브 도메인 도구 3종(list_drive_spaces/list_drive_items/search_drive) 을 구성한다. */
export function buildDriveTools(client: PatApiClient): McpTool[] {
  const listDriveSpacesInput = z.object({});
  const listDriveItemsInput = z.object({
    spaceId: z.number().int(),
    parentId: z.number().int().optional(),
  });
  const searchDriveInput = z.object({ spaceId: z.number().int(), q: z.string().min(1) });

  return [
    {
      name: 'list_drive_spaces',
      description: '접근 가능한 드라이브 스페이스 목록을 JSON 으로 반환합니다.',
      inputSchema: listDriveSpacesInput,
      async handler() {
        return JSON.stringify(await client.listDriveSpaces());
      },
    },
    {
      name: 'list_drive_items',
      description:
        '스페이스의 폴더/파일 목록을 JSON 으로 반환합니다. parentId 생략 시 최상위 항목만 조회합니다.',
      inputSchema: listDriveItemsInput,
      async handler(args) {
        const { spaceId, parentId } = listDriveItemsInput.parse(args);
        return JSON.stringify(await client.listDriveItems(spaceId, parentId));
      },
    },
    {
      name: 'search_drive',
      description: '스페이스 내 파일/폴더를 검색어로 검색해 JSON 으로 반환합니다.',
      inputSchema: searchDriveInput,
      async handler(args) {
        const { spaceId, q } = searchDriveInput.parse(args);
        return JSON.stringify(await client.searchDrive(spaceId, q));
      },
    },
  ];
}
