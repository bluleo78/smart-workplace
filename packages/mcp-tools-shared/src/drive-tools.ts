// src/drive-tools.ts — 드라이브 읽기 도구 + 휴지통 복원. 두 앱 공유(#846, #850, #854).
// 파일 행은 toDriveItemsView 로 core fileId 를 지우고 driveFileId 로만 노출한다(#840).
import { z } from 'zod';
import { toDriveContentHitsView, toDriveItemsView, toDriveTrashView } from './drive-view.js';
import type { SharedTool } from './mcp-tool.js';
import type { DriveToolClient } from './tool-client.js';

type DriveItems = Parameters<typeof toDriveItemsView>[0];

export const listDriveItemsInput = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
});
export const searchDriveInput = z.object({ spaceId: z.number().int().positive(), q: z.string().min(1) });
export const getDriveFileSummaryInput = z.object({ driveFileId: z.number().int().positive() });
export const searchDriveContentInput = z.object({
  query: z.string().min(1),
  spaceId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const listDriveTrashInput = z.object({ spaceId: z.number().int().positive() });
// 파일과 폴더는 id 시퀀스가 달라 한쪽만 받는다 — 둘 다 오면 어느 것을 복원할지 모호하다.
export const restoreDriveItemInput = z
  .object({ driveFileId: z.number().int().positive().optional(), folderId: z.number().int().positive().optional() })
  .refine((v) => (v.driveFileId === undefined) !== (v.folderId === undefined), {
    message: 'driveFileId 와 folderId 중 정확히 하나만 주세요.',
  });

/** 드라이브 도구(읽기 + 휴지통 목록·복원). 영구 삭제·휴지통 비우기는 되돌릴 수 없어 두지 않는다. */
export function buildDriveTools(client: DriveToolClient): SharedTool[] {
  return [
    {
      name: 'list_drive_spaces',
      kind: 'read',
      description: '내가 접근 가능한 드라이브 스페이스 목록을 JSON 으로 반환합니다.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.listDriveSpaces());
      },
    },
    {
      name: 'list_drive_items',
      kind: 'read',
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
      kind: 'read',
      description: '드라이브 스페이스에서 파일/폴더를 이름으로 검색해 JSON 으로 반환합니다. 폴더는 id(= folderId), 파일은 driveFileId 로 가리킵니다.',
      inputSchema: searchDriveInput,
      async handler(args) {
        const { spaceId, q } = searchDriveInput.parse(args);
        return JSON.stringify(toDriveItemsView((await client.searchDrive(spaceId, q)) as DriveItems));
      },
    },
    {
      name: 'get_drive_file_summary',
      kind: 'read',
      description:
        '드라이브 파일 내용의 AI 요약을 JSON({summary, status, reason})으로 반환합니다. "이 파일 뭐라고 써 있어?" 류 질문에 사용하세요. ' +
        'status 가 DONE 일 때만 summary 가 있습니다. PENDING·EXTRACTING·TEXT_READY·SUMMARIZING 이면 아직 준비 중, FAILED·SKIPPED 면 요약할 수 없는 파일이므로(reason 참고) ' +
        '내용을 추측하지 말고 그 상태를 그대로 알리세요. driveFileId 는 list_drive_items·search_drive·search_drive_content 결과의 값입니다.',
      inputSchema: getDriveFileSummaryInput,
      async handler(args) {
        const { driveFileId } = getDriveFileSummaryInput.parse(args);
        return JSON.stringify(await client.getDriveFileSummary(driveFileId));
      },
    },
    {
      name: 'search_drive_content',
      kind: 'read',
      description:
        '접근 가능한 드라이브 파일을 **내용**(추출 텍스트, 의미 검색 포함)으로 검색해 JSON({hits, semantic})으로 반환합니다. 각 hit 은 driveFileId·name·spaceName·snippet 을 담습니다. ' +
        '파일 이름으로 찾을 때는 search_drive 를 쓰세요. spaceId 로 한 스페이스만 좁힐 수 있고 limit 기본 10(최대 50).',
      inputSchema: searchDriveContentInput,
      async handler(args) {
        const { query, spaceId, limit } = searchDriveContentInput.parse(args);
        return JSON.stringify(toDriveContentHitsView(await client.searchDriveContent({ q: query, spaceId, limit })));
      },
    },
    {
      name: 'list_drive_trash',
      kind: 'read',
      description:
        '드라이브 스페이스 휴지통의 항목을 JSON 배열(type·name·originalPath·trashedAt·autoPurgeAt, 파일은 driveFileId·폴더는 folderId)로 반환합니다. ' +
        'autoPurgeAt 이 지나면 영구 삭제됩니다. 복원은 restore_drive_item 을 쓰세요.',
      inputSchema: listDriveTrashInput,
      async handler(args) {
        const { spaceId } = listDriveTrashInput.parse(args);
        return JSON.stringify(toDriveTrashView(await client.listDriveTrash(spaceId)));
      },
    },
    {
      name: 'restore_drive_item',
      kind: 'write',
      description:
        '휴지통의 파일(driveFileId) 또는 폴더(folderId)를 원래 위치로 복원합니다. 둘 중 하나만 주세요(list_drive_trash 결과의 값). ' +
        '함께 삭제된 항목은 같이 복원되고, 원래 폴더가 없으면 최상위로, 같은 이름이 있으면 이름을 바꿔 복원됩니다.',
      inputSchema: restoreDriveItemInput,
      async handler(args) {
        const { driveFileId, folderId } = restoreDriveItemInput.parse(args);
        if (driveFileId !== undefined) await client.restoreDriveFile(driveFileId);
        else await client.restoreDriveFolder(folderId!);
        return 'ok';
      },
    },
  ];
}
