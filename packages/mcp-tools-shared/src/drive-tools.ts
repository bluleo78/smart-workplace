// src/drive-tools.ts — 드라이브 읽기 도구 + 폴더·파일 정리(생성·이름변경·이동) + 휴지통 복원. 두 앱 공유(#846, #850, #854).
// 파일 행은 toDriveItemsView 로 core fileId 를 지우고 driveFileId 로만 노출한다(#840).
import { z } from 'zod';
import { omitKeys } from './compact.js';
import { toDriveContentHitsView, toDriveFolderView, toDriveItemsView, toDriveTrashView } from './drive-view.js';
import type { SharedTool } from './mcp-tool.js';
import type { DriveToolClient } from './tool-client.js';

type DriveItems = Parameters<typeof toDriveItemsView>[0];

export const listDriveItemsInput = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
  // WP-352: 폴더 하나에 항목이 수천 개일 수 있어 서버가 limit·offset 페이지를 지원한다(서버 상한 1000 — 다음 페이지 확인용 +1 을 보내므로 500).
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0).describe('건너뛸 항목 수 — 이전 호출 결과의 nextOffset 을 그대로'),
});
export const searchDriveInput = z.object({
  spaceId: z.number().int().positive(),
  q: z.string().min(1),
  // 서버는 폴더·파일을 각각 최대 SEARCH_SERVER_CAP 건까지만 준다 — 그 안에서 도구가 한 번에 보여 줄 수를 정한다.
  limit: z.number().int().min(1).max(200).default(50),
});

/**
 * 서버 이름 검색이 폴더·파일 각각에 거는 상한(DriveFolderRepository.searchByName·DriveFileRepository.searchByName 의 .limit(200)).
 * 서버가 잘렸는지는 알리지 않아, 이 수에 닿으면 더 있을 수 있다고 본다. 서버 상한을 바꾸면 이 값도 맞춘다.
 */
const SEARCH_SERVER_CAP = 200;
export const getDriveFileSummaryInput = z.object({ driveFileId: z.number().int().positive() });
export const searchDriveContentInput = z.object({
  query: z.string().min(1),
  spaceId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

// 폴더·파일 쓰기 — 폴더는 rename/move 와 같은 folderId, 파일은 driveFileId 로 통일한다(#840: 목록 응답의 core fileId 와 혼동 방지).
export const createDriveFolderInput = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(255),
});
export const renameDriveFolderInput = z.object({ folderId: z.number().int().positive(), name: z.string().min(1).max(255) });
export const moveDriveFolderInput = z.object({
  folderId: z.number().int().positive(),
  targetParentId: z.number().int().positive().nullable().optional(),
});
export const moveDriveFileInput = z.object({
  driveFileId: z.number().int().positive(),
  targetFolderId: z.number().int().positive().nullable().optional(),
});

export const listDriveTrashInput = z.object({ spaceId: z.number().int().positive() });
// 파일과 폴더는 id 시퀀스가 달라 한쪽만 받는다 — 둘 다 오면 어느 것을 복원할지 모호하다.
export const restoreDriveItemInput = z
  .object({ driveFileId: z.number().int().positive().optional(), folderId: z.number().int().positive().optional() })
  .refine((v) => (v.driveFileId === undefined) !== (v.folderId === undefined), {
    message: 'driveFileId 와 folderId 중 정확히 하나만 주세요.',
  });

/** 드라이브 도구(읽기 + 폴더 생성·이름변경·이동 + 파일 이동 + 휴지통 목록·복원). 영구 삭제·휴지통 비우기는 되돌릴 수 없어 두지 않는다(삭제는 propose_* 확인 카드). */
export function buildDriveTools(client: DriveToolClient): SharedTool[] {
  return [
    {
      name: 'list_drive_spaces',
      app: 'drive',
      kind: 'read',
      description:
        '내가 멤버인 드라이브 스페이스(내 드라이브 + 팀 스페이스 + 채널 드라이브) 목록을 JSON 으로 반환합니다. 내 드라이브가 먼저, 나머지는 이름순이며 ' +
        '각 항목은 id(= 다른 드라이브 도구의 spaceId)·type(PERSONAL=내 드라이브 / TEAM=팀 스페이스 / CHANNEL=메시징 채널에 연결된 드라이브)·name·role(내 역할 OWNER/EDITOR/VIEWER)·archived(true 면 읽기 전용)를 가집니다.',
      inputSchema: z.object({}),
      async handler() {
        // 스페이스 소유자 ownerId 는 숫자 사용자 ID 라 내보내지 않는다(#833, WP-353) — 내 역할은 role 로 알 수 있다.
        return JSON.stringify(((await client.listDriveSpaces()) as Record<string, unknown>[]).map((space) => omitKeys(space, 'ownerId')));
      },
    },
    {
      name: 'list_drive_items',
      app: 'drive',
      kind: 'read',
      description:
        '드라이브 스페이스(또는 parentId 폴더 하위)의 폴더/파일 목록을 JSON({folders, files, hasMore?, nextOffset?})으로 반환합니다. parentId 생략 시 최상위(parentId 는 폴더 행의 folderId — 행의 parentId 필드가 아닙니다). ' +
        '폴더는 folderId, 파일은 driveFileId 로 가리킵니다. 폴더 먼저·파일 다음(각각 이름순)으로 한 번에 limit 개(기본 200, 최대 500)만 담기며, ' +
        '더 있으면 hasMore:true 와 nextOffset 이 옵니다 — nextOffset 을 offset 으로 넘겨 이어 조회하거나, 이어 조회하지 않고 답한다면 일부만 본 것이라고 밝히세요' +
        '(개수 집계·"전부 …" 단정을 하지 마세요). 이 키들이 없으면 전부 담긴 것입니다.',
      inputSchema: listDriveItemsInput,
      async handler(args) {
        const { spaceId, parentId, limit, offset } = listDriveItemsInput.parse(args);
        // 한 건 더 달라고 해 다음 페이지가 있는지 확인한다(서버는 총 개수를 주지 않는다). 폴더 먼저·파일 다음 순서라 넘친 한 건은 항상 끝에 있다.
        const view = toDriveItemsView((await client.listDriveItems(spaceId, parentId, { limit: limit + 1, offset })) as DriveItems);
        const hasMore = view.folders.length + view.files.length > limit;
        const folders = view.folders.slice(0, limit);
        const files = view.files.slice(0, limit - folders.length);
        return JSON.stringify({
          folders,
          files,
          ...(hasMore && { hasMore: true, nextOffset: offset + folders.length + files.length }),
        });
      },
    },
    {
      name: 'search_drive',
      app: 'drive',
      kind: 'read',
      description:
        '드라이브 스페이스에서 파일/폴더를 이름으로 검색해 JSON({folders, files, truncated?})으로 반환합니다. 폴더는 folderId, 파일은 driveFileId 로 가리킵니다. ' +
        '폴더·파일 각각 이름순으로 limit 개(기본 50, 최대 200)만 담기고, 더 있을 수 있으면 truncated:true 가 옵니다 — 이어 조회하는 방법은 없으니 q 를 더 구체적으로 바꿔 다시 검색하거나, ' +
        '그대로 답한다면 일부만 본 것이라고 밝히세요(개수 집계·"전부 …" 단정 금지). truncated 가 없으면 검색된 전부입니다.',
      inputSchema: searchDriveInput,
      async handler(args) {
        const { spaceId, q, limit } = searchDriveInput.parse(args);
        const view = toDriveItemsView((await client.searchDrive(spaceId, q)) as DriveItems);
        // 도구 limit 으로 잘렸거나(원본이 limit 보다 많음) 서버 상한에 닿았으면(서버가 더 자른 것일 수 있음) 잘림으로 알린다.
        const truncated = [view.folders, view.files].some((rows) => rows.length > limit || rows.length >= SEARCH_SERVER_CAP);
        return JSON.stringify({
          folders: view.folders.slice(0, limit),
          files: view.files.slice(0, limit),
          ...(truncated && { truncated: true }),
        });
      },
    },
    {
      name: 'get_drive_file_summary',
      app: 'drive',
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
      app: 'drive',
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
      app: 'drive',
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
      app: 'drive',
      kind: 'write',
      // 다시 부르면 휴지통에 없다는 오류가 난다(DriveNotInTrashException) — 멱등이 아니다.
      hints: { destructive: false, idempotent: false },
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
    {
      name: 'create_drive_folder',
      app: 'drive',
      kind: 'write',
      // 같은 위치에 같은 이름이 있으면 서버가 409(DriveDuplicateNameException) — 다시 부르면 오류라 멱등이 아니다.
      hints: { destructive: false, idempotent: false },
      description:
        '드라이브 스페이스에 새 폴더를 생성합니다. parentId 에 상위 폴더의 folderId 를 주면 그 하위에 만들고, 생략하면 스페이스 루트에 생성합니다. 생성된 폴더를 JSON 으로 반환합니다.',
      inputSchema: createDriveFolderInput,
      async handler(args) {
        const { spaceId, parentId, name } = createDriveFolderInput.parse(args);
        return JSON.stringify(toDriveFolderView((await client.createDriveFolder(spaceId, parentId ?? null, name)) as { id: number }));
      },
    },
    {
      name: 'rename_drive_folder',
      app: 'drive',
      kind: 'write',
      // 이전 이름을 덮어쓴다(destructive). 같은 이름으로 다시 불러도 저장 상태가 그대로이고 이력·알림이 쌓이지 않는다(멱등).
      hints: { destructive: true, idempotent: true },
      description: '폴더 이름을 변경합니다. 변경된 폴더를 JSON 으로 반환합니다.',
      inputSchema: renameDriveFolderInput,
      async handler(args) {
        const { folderId, name } = renameDriveFolderInput.parse(args);
        return JSON.stringify(toDriveFolderView((await client.renameDriveFolder(folderId, name)) as { id: number }));
      },
    },
    {
      name: 'move_drive_folder',
      app: 'drive',
      kind: 'write',
      // 상위 폴더를 바꾼다(destructive, move_wiki_page 와 같은 기준). 이미 그 위치면 서버가 no-op 이라 다시 불러도 같은 결과(멱등).
      hints: { destructive: true, idempotent: true },
      description: '폴더를 다른 상위 폴더로 이동합니다. targetParentId 는 대상 상위 폴더의 folderId 이고(행의 parentId 필드가 아님), 생략하면 스페이스 루트로 이동합니다.',
      inputSchema: moveDriveFolderInput,
      async handler(args) {
        const { folderId, targetParentId } = moveDriveFolderInput.parse(args);
        await client.moveDriveFolder(folderId, targetParentId ?? null);
        return 'ok';
      },
    },
    {
      name: 'move_drive_file',
      app: 'drive',
      kind: 'write',
      // move_drive_folder 와 같다 — 위치를 바꾸고(destructive), 이미 그 폴더면 서버가 no-op(멱등).
      hints: { destructive: true, idempotent: true },
      description:
        '파일을 다른 폴더로 이동합니다. driveFileId 는 list_drive_items/search_drive 파일 항목의 driveFileId 입니다. targetFolderId 는 대상 폴더의 folderId 이고, 생략하면 스페이스 루트로 이동합니다.',
      inputSchema: moveDriveFileInput,
      async handler(args) {
        const { driveFileId, targetFolderId } = moveDriveFileInput.parse(args);
        await client.moveDriveFile(driveFileId, targetFolderId ?? null);
        return 'ok';
      },
    },
  ];
}
