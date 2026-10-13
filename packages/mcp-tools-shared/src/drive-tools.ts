// src/drive-tools.ts — 드라이브 읽기 도구 + 폴더·파일 정리(생성·이름변경·이동·복사) + 첨부 가져오기 + 휴지통 복원. 두 앱 공유(#846, #850, #854, WP-354).
// WP-369: 파일·폴더 이름변경·이동을 rename_drive_item·move_drive_item 하나씩으로 합쳤고, 전송 링크(create_drive_download_link)와
// 파일 올리기(create_drive_file: 내용으로 쓰기 또는 업로드 링크 — 새 파일(spaceId+name) 또는 기존 파일의 새 버전(driveFileId))를 더했다.
// 파일 행은 toDriveItemsView 로 core fileId 를 지우고 driveFileId 로만 노출한다(#840).
import { z } from 'zod';
import { omitKeys } from './compact.js';
import {
  toDriveBacklinksView,
  toDriveContentHitsView,
  toDriveDownloadLinkView,
  toDriveFileView,
  toDriveFolderView,
  toDriveItemsView,
  toDriveTrashView,
  toDriveUploadLinkView,
  toDriveVersionsView,
} from './drive-view.js';
import type { SharedTool } from './mcp-tool.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { DriveToolClient } from './tool-client.js';

type DriveItems = Parameters<typeof toDriveItemsView>[0];

export const listDriveItemsInput = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
  // WP-352: 폴더 하나에 항목이 수천 개일 수 있어 서버가 limit·offset 페이지를 지원한다(서버 상한 1000 — 다음 페이지 확인용 +1 을 보내므로 500).
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
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
// WP-354: 버전 목록·백링크는 별도 도구가 아니라 파일 상세 도구의 옵션이다(앱당 도구 상한). 모델이 쓰지 않는 옵션을 null 로 채워 보내도 받는다.
export const getDriveFileSummaryInput = z.object({
  driveFileId: z.number().int().positive(),
  includeVersions: nullAsOmitted(z.boolean()),
  includeBacklinks: nullAsOmitted(z.boolean()),
});
export const searchDriveContentInput = z.object({
  query: z.string().min(1),
  spaceId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

// 폴더·파일 쓰기 — 폴더는 folderId, 파일은 driveFileId 로 통일한다(#840: 목록 응답의 core fileId 와 혼동 방지).
// 상위·대상 폴더는 생략과 null 이 모두 "스페이스 루트" 라(핸들러가 ?? null) nullAsOmitted — 외부 MCP 정의에는 null 갈래를 숨긴다(WP-340 웨이브 5).
export const createDriveFolderInput = z.object({
  spaceId: z.number().int().positive(),
  parentId: nullAsOmitted(z.number().int().positive()),
  name: z.string().min(1).max(255),
});
// 이름변경·이동은 파일·폴더를 한 도구로 받는다(WP-369: 드라이브 앱 도구 15개 상한 안에 전송 도구 자리를 만들려고 둘씩 합쳤다).
// restore_drive_item·copy_drive_item 과 같은 이유로 driveFileId·folderId 중 정확히 하나만 받는다 — 둘은 다른 시퀀스라 둘 다 오면 모호하다.
// 모델은 쓰지 않는 id 를 null 로 채워 보내기도 해(WP-346 read_file 사례) 두 id 는 nullAsOmitted 이고, null 은 생략과 같게 센다(== null).
const exactlyOneItem = (v: { driveFileId?: number | null; folderId?: number | null }) => (v.driveFileId == null) !== (v.folderId == null);
const exactlyOneItemMessage = { message: 'driveFileId 와 folderId 중 정확히 하나만 주세요.' };
export const renameDriveItemInput = z
  .object({
    driveFileId: nullAsOmitted(z.number().int().positive()),
    folderId: nullAsOmitted(z.number().int().positive()),
    name: z.string().min(1).max(255),
  })
  .refine(exactlyOneItem, exactlyOneItemMessage);
// 대상은 파일·폴더 모두 targetFolderId 하나다(copy_drive_item 과 같은 이름) — 폴더 이동 API 의 targetParentId 로는 핸들러가 옮겨 담는다.
// 생략과 null 이 모두 스페이스 루트다(서버 move 가 null 폴더를 루트로 받는다).
export const moveDriveItemInput = z
  .object({
    driveFileId: nullAsOmitted(z.number().int().positive()),
    folderId: nullAsOmitted(z.number().int().positive()),
    targetFolderId: nullAsOmitted(z.number().int().positive()),
  })
  .refine(exactlyOneItem, exactlyOneItemMessage);
// 복사 원본은 파일·폴더 중 하나다(restore_drive_item 과 같은 이유로 둘 다 오면 모호). 대상 폴더는 생략과 null 이 모두 스페이스 루트.
export const copyDriveItemInput = z
  .object({
    driveFileId: nullAsOmitted(z.number().int().positive()),
    folderId: nullAsOmitted(z.number().int().positive()),
    targetFolderId: nullAsOmitted(z.number().int().positive()),
  })
  .refine(exactlyOneItem, exactlyOneItemMessage);
export const importAttachmentToDriveInput = z.object({
  spaceId: z.number().int().positive(),
  attachmentId: z.number().int().positive(),
  folderId: nullAsOmitted(z.number().int().positive()),
});

// WP-369: 전송 링크·텍스트로 만들기. 바이트는 MCP 를 거치지 않는다 — 다운로드·업로드 링크를 받은 쪽(curl·브라우저)이 공개 경로로 주고받는다.
export const createDriveDownloadLinkInput = z.object({ driveFileId: z.number().int().positive() });
// content 가 있으면(빈 문자열 포함 — 서버가 빈 파일을 받는다) 텍스트로 쓰고, 없거나 null 이면 업로드 링크를 발급한다.
// 대상은 둘 중 하나다: spaceId+name(folderId 는 선택) 이면 그 위치에 새 파일(같은 이름이 있으면 새 버전), driveFileId 면 그 파일의 새 버전
// (이름·폴더 그대로, WP-369 Task 3). 둘을 섞으면 어느 쪽인지 모호하고 name 을 이름변경으로 오해할 수 있어 거절한다. 모든 입력은 null = 생략.
// MCP JSON 본문 상한(4MB)과 서버 텍스트 상한(10MB) 안에서만 content 를 받을 수 있다 — 큰 파일은 링크로 올린다.
export const createDriveFileInput = z
  .object({
    driveFileId: nullAsOmitted(z.number().int().positive()),
    spaceId: nullAsOmitted(z.number().int().positive()),
    folderId: nullAsOmitted(z.number().int().positive()),
    name: nullAsOmitted(z.string().min(1).max(255)),
    content: nullAsOmitted(z.string()),
  })
  .refine(
    (v) => (v.driveFileId == null ? v.spaceId != null && v.name != null : v.spaceId == null && v.folderId == null && v.name == null),
    { message: 'driveFileId(기존 파일의 새 버전)를 주면 spaceId·folderId·name 은 빼고, 새 파일이면 driveFileId 없이 spaceId 와 name 을 주세요.' },
  );

export const listDriveTrashInput = z.object({ spaceId: z.number().int().positive() });
// 파일과 폴더는 id 시퀀스가 달라 한쪽만 받는다 — 둘 다 오면 어느 것을 복원할지 모호하다.
export const restoreDriveItemInput = z
  .object({ driveFileId: nullAsOmitted(z.number().int().positive()), folderId: nullAsOmitted(z.number().int().positive()) })
  .refine(exactlyOneItem, exactlyOneItemMessage);

// WP-369: 전송 도구 설명. 정의 크기 상한(15,000 근사 토큰) 안에 맞추려고 실패·재시도 절차는 응답(note·howTo)에도 싣는다.
const DOWNLOAD_LINK_DESCRIPTION =
  'Creates a download link for a drive file, valid 10 minutes with no login: show it only to the user. Works once; a failed or ' +
  'interrupted download needs a new link. Shell: curl -o "<name>" "<url>". To read content, use read_file.';
const CREATE_FILE_DESCRIPTION =
  'Uploads a drive file: new at spaceId+name (folderId or root; a taken name becomes a new version), or a new version of driveFileId ' +
  '(same name and folder); needs EDITOR. With content: writes text (md, txt, csv, json; up to a few MB); driveFileId must be a text ' +
  'file. Without: returns a one-time upload link valid 10 minutes, up to maxBytes: curl -T <file> "<uploadUrl>", no -H Content-Type; ' +
  'for driveFileId, the same file type; a failure needs a new link. Chat-attached files can\'t use it: ask the user to upload in the web ' +
  'drive.';

/** 드라이브 도구(읽기 + 폴더 생성 + 파일·폴더 이름변경·이동·복사 + 첨부 가져오기 + 휴지통 목록·복원 + 전송 링크·텍스트로 만들기). 영구 삭제·휴지통 비우기는 되돌릴 수 없어 두지 않는다(삭제는 propose_* 확인 카드). */
export function buildDriveTools(client: DriveToolClient): SharedTool[] {
  return [
    {
      name: 'list_drive_spaces',
      app: 'drive',
      kind: 'read',
      description:
        'Lists drive (드라이브) spaces I belong to: id (spaceId of other drive tools), type (PERSONAL = my drive, TEAM, CHANNEL = linked to a ' +
        'channel), role (OWNER, EDITOR, VIEWER), archived (true = read-only).',
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
        'Lists folders then files (folderId, driveFileId) at a drive space root or in folder parentId (a folderId, not a row parentId) as ' +
        '{folders, files, hasMore?, nextOffset?}. If hasMore, pass nextOffset as offset, or say the list is partial.',
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
        'Searches a drive space for folders and files by name substring: {folders, files, truncated?}, up to limit each. truncated:true means ' +
        'more may exist and there is no next page: refine q, or say the result is partial.',
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
        'AI summary of a drive file: {summary, status, reason}. Only DONE has a summary; otherwise reason set = not summarizable, no ' +
        'reason = not ready yet; never guess. includeVersions adds versions (newest first); includeBacklinks adds issues and messages ' +
        'linking it.',
      inputSchema: getDriveFileSummaryInput,
      async handler(args) {
        const { driveFileId, includeVersions, includeBacklinks } = getDriveFileSummaryInput.parse(args);
        // 옵션이 켜진 조회만 병렬로 보낸다 — 요약만 필요한 일반 호출은 요청 수가 그대로다.
        const [summary, versions, backlinks] = await Promise.all([
          client.getDriveFileSummary(driveFileId),
          includeVersions ? client.listDriveFileVersions(driveFileId) : undefined,
          includeBacklinks ? client.listDriveFileBacklinks(driveFileId) : undefined,
        ]);
        return JSON.stringify({
          ...(summary as Record<string, unknown>),
          ...(versions && { versions: toDriveVersionsView(versions) }),
          ...(backlinks && { backlinks: toDriveBacklinksView(backlinks) }),
        });
      },
    },
    {
      name: 'search_drive_content',
      app: 'drive',
      kind: 'read',
      description:
        'Searches drive file content (extracted text, semantic too): {hits, semantic}; hits: driveFileId, name, spaceName, ' +
        'snippet. spaceId narrows to one space. For file names use search_drive.',
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
        "Lists a drive space's trash: originalPath, trashedAt, autoPurgeAt (permanent deletion time), driveFileId (file) or folderId (folder).",
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
        'Restores a trashed file (driveFileId) or folder (folderId) from list_drive_trash; give exactly one. Items deleted together return ' +
        'together; lacking its folder it goes to the root; a name clash gets a new name.',
      inputSchema: restoreDriveItemInput,
      async handler(args) {
        const { driveFileId, folderId } = restoreDriveItemInput.parse(args);
        if (driveFileId != null) await client.restoreDriveFile(driveFileId);
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
        'Creates a folder in a drive space, inside parentId (a folderId) or at the root when omitted; needs EDITOR.',
      inputSchema: createDriveFolderInput,
      async handler(args) {
        const { spaceId, parentId, name } = createDriveFolderInput.parse(args);
        return JSON.stringify(toDriveFolderView((await client.createDriveFolder(spaceId, parentId ?? null, name)) as { id: number }));
      },
    },
    {
      name: 'rename_drive_item',
      app: 'drive',
      kind: 'write',
      // 이전 이름을 덮어쓴다(destructive). 같은 이름으로 다시 불러도 저장 상태가 그대로이고 이력·알림이 쌓이지 않는다(멱등).
      hints: { destructive: true, idempotent: true },
      description:
        'Renames a file (driveFileId) or folder (folderId); give exactly one. Needs EDITOR; fails if the name is taken there.',
      inputSchema: renameDriveItemInput,
      async handler(args) {
        const { driveFileId, folderId, name } = renameDriveItemInput.parse(args);
        if (driveFileId != null) {
          return JSON.stringify(toDriveFileView((await client.renameDriveFile(driveFileId, name)) as { id: number; fileId: number }));
        }
        return JSON.stringify(toDriveFolderView((await client.renameDriveFolder(folderId!, name)) as { id: number }));
      },
    },
    {
      name: 'move_drive_item',
      app: 'drive',
      kind: 'write',
      // 위치를 바꾼다(destructive, move_wiki_page 와 같은 기준). 이미 그 위치면 서버가 no-op 이라 다시 불러도 같은 결과(멱등).
      hints: { destructive: true, idempotent: true },
      description:
        'Moves a file (driveFileId) or folder (folderId) into targetFolderId (a folderId) of the same space, or the root when omitted; give ' +
        'exactly one. Needs EDITOR.',
      inputSchema: moveDriveItemInput,
      async handler(args) {
        const { driveFileId, folderId, targetFolderId } = moveDriveItemInput.parse(args);
        if (driveFileId != null) await client.moveDriveFile(driveFileId, targetFolderId ?? null);
        else await client.moveDriveFolder(folderId!, targetFolderId ?? null);
        return 'ok';
      },
    },
    {
      name: 'copy_drive_item',
      app: 'drive',
      kind: 'write',
      // 새 항목을 만든다(destructive 아님). 같은 이름이 이미 있으면 서버가 409 라 다시 부르면 오류 — 멱등이 아니다.
      hints: { destructive: false, idempotent: false },
      description:
        'Copies a file (driveFileId) or folder with contents (folderId); give exactly one. Keeps its name, into targetFolderId (a folderId) ' +
        'of the same space or the root; fails if the name is taken there (always in its own folder). Needs EDITOR.',
      inputSchema: copyDriveItemInput,
      async handler(args) {
        const { driveFileId, folderId, targetFolderId } = copyDriveItemInput.parse(args);
        if (driveFileId != null) {
          return JSON.stringify(toDriveFileView((await client.copyDriveFile(driveFileId, targetFolderId ?? null)) as { id: number; fileId: number }));
        }
        return JSON.stringify(toDriveFolderView((await client.copyDriveFolder(folderId!, targetFolderId ?? null)) as { id: number }));
      },
    },
    {
      name: 'create_drive_download_link',
      app: 'drive',
      // 링크 행만 만들고 사용자 데이터는 바꾸지 않지만 read 로 두지 않는다 — 읽기 전용을 자동 승인하는 클라이언트가 묻지 않고
      // 로그인 없이 받을 수 있는 링크를 만들게 되기 때문이다(WP-369 R1). 10분·한 번·발급자 권한 재확인이라 외부 공개 링크(destructive)는 아니다.
      kind: 'write',
      // 부를 때마다 새 링크를 만든다(비멱등). 기존 데이터를 덮어쓰거나 지우지 않는다.
      hints: { destructive: false, idempotent: false },
      description: DOWNLOAD_LINK_DESCRIPTION,
      inputSchema: createDriveDownloadLinkInput,
      async handler(args) {
        const { driveFileId } = createDriveDownloadLinkInput.parse(args);
        // 서버 응답에서 {url, expiresAt, name, sizeBytes, mimeType, singleUse} 만 고른다(허용 목록 — 이유는 toDriveDownloadLinkView).
        return JSON.stringify(toDriveDownloadLinkView(await client.createDriveDownloadLink(driveFileId)));
      },
    },
    {
      name: 'create_drive_file',
      app: 'drive',
      kind: 'write',
      // 새 파일이나 새 버전을 만든다 — 이전 버전은 버전 목록에 남아 되돌릴 수 있어 destructive 가 아니다. 다시 부르면 버전이 또 쌓이거나 링크가 또 생겨 비멱등.
      hints: { destructive: false, idempotent: false },
      description: CREATE_FILE_DESCRIPTION,
      inputSchema: createDriveFileInput,
      async handler(args) {
        const { driveFileId, spaceId, folderId, name, content } = createDriveFileInput.parse(args);
        // 빈 문자열도 content 다(빈 파일) — 진릿값으로 가르면 ""가 업로드 링크로 새어 나간다.
        if (driveFileId != null) {
          // 기존 파일의 새 버전 — 이름·폴더는 서버가 그대로 둔다. 텍스트 갱신은 현재 버전이 텍스트일 때만 된다(아니면 서버 409).
          if (content != null) {
            return JSON.stringify(toDriveFileView((await client.updateDriveTextFile(driveFileId, content)) as { id: number; fileId: number }));
          }
          return JSON.stringify(toDriveUploadLinkView(await client.createDriveVersionUploadLink(driveFileId), driveFileId));
        }
        // refine 이 driveFileId 가 없으면 spaceId·name 이 있음을 확인했으므로 단정(!)해도 된다.
        if (content != null) {
          return JSON.stringify(
            toDriveFileView((await client.createDriveTextFile(spaceId!, folderId ?? null, name!, content)) as { id: number; fileId: number }),
          );
        }
        return JSON.stringify(toDriveUploadLinkView(await client.createDriveUploadLink(spaceId!, folderId ?? null, name!)));
      },
    },
    {
      name: 'import_attachment_to_drive',
      app: 'drive',
      kind: 'write',
      // 새 drive 파일을 만든다(destructive 아님). 같은 첨부를 같은 위치에 다시 가져오면 이름이 겹쳐 409 — 멱등이 아니다.
      hints: { destructive: false, idempotent: false },
      description:
        'Saves an issue or chat attachment into a drive space (folderId or root); needs EDITOR. attachmentId: attachments[].attachmentId from ' +
        'get_issue_detail or attachments[].fileId from list_channel_messages. Keeps its name; fails if taken there.',
      inputSchema: importAttachmentToDriveInput,
      async handler(args) {
        const { spaceId, attachmentId, folderId } = importAttachmentToDriveInput.parse(args);
        return JSON.stringify(
          toDriveFileView((await client.importAttachmentToDrive(spaceId, folderId ?? null, attachmentId)) as { id: number; fileId: number }),
        );
      },
    },
  ];
}
