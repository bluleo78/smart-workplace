// src/drive-tools.ts — 드라이브 읽기 도구 3종. 두 앱 공유(#846).
// 파일 행은 toDriveItemsView 로 core fileId 를 지우고 driveFileId 로만 노출한다(#840).
import { z } from 'zod';
import { toDriveItemsView } from './drive-view.js';
import type { McpTool } from './mcp-tool.js';
import type { DriveToolClient } from './tool-client.js';

type DriveItems = Parameters<typeof toDriveItemsView>[0];

export const listDriveItemsInput = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
});
export const searchDriveInput = z.object({ spaceId: z.number().int().positive(), q: z.string().min(1) });

/** 드라이브 읽기 도구 3종(list_drive_spaces/list_drive_items/search_drive). */
export function buildDriveTools(client: DriveToolClient): McpTool[] {
  return [
    {
      name: 'list_drive_spaces',
      description: '내가 접근 가능한 드라이브 스페이스 목록을 JSON 으로 반환합니다.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listDriveSpaces());
      },
    },
    {
      name: 'list_drive_items',
      description:
        '드라이브 스페이스(또는 parentId 폴더 하위)의 폴더/파일 목록을 JSON 으로 반환합니다. parentId 생략 시 최상위. 폴더는 id(= folderId), 파일은 driveFileId 로 가리킵니다.',
      inputSchema: listDriveItemsInput,
      async handler(args) {
        const { spaceId, parentId } = listDriveItemsInput.parse(args);
        return JSON.stringify(toDriveItemsView((await client.listDriveItems(spaceId, parentId)) as DriveItems));
      },
    },
    {
      name: 'search_drive',
      description: '드라이브 스페이스에서 파일/폴더를 이름으로 검색해 JSON 으로 반환합니다. 폴더는 id(= folderId), 파일은 driveFileId 로 가리킵니다.',
      inputSchema: searchDriveInput,
      async handler(args) {
        const { spaceId, q } = searchDriveInput.parse(args);
        return JSON.stringify(toDriveItemsView((await client.searchDrive(spaceId, q)) as DriveItems));
      },
    },
  ];
}
