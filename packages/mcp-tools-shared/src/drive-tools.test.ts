import { describe, expect, it, vi } from 'vitest';
import { buildDriveTools } from './drive-tools.js';
import type { DriveToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

/** 드라이브 클라이언트 mock. */
function mockClient(): DriveToolClient {
  return {
    listDriveSpaces: vi.fn().mockResolvedValue([]),
    listDriveItems: vi.fn().mockResolvedValue({ folders: [], files: [] }),
    searchDrive: vi.fn().mockResolvedValue({ folders: [], files: [] }),
    getDriveFileSummary: vi.fn().mockResolvedValue({ summary: null, status: 'PENDING', reason: null }),
    searchDriveContent: vi.fn().mockResolvedValue({ hits: [], semantic: false }),
    listDriveTrash: vi.fn().mockResolvedValue([]),
    restoreDriveFile: vi.fn().mockResolvedValue(undefined),
    restoreDriveFolder: vi.fn().mockResolvedValue(undefined),
    createDriveFolder: vi.fn().mockResolvedValue({ id: 10, name: '신규폴더' }),
    renameDriveFolder: vi.fn().mockResolvedValue({ id: 4, name: '새이름' }),
    moveDriveFolder: vi.fn().mockResolvedValue(undefined),
    moveDriveFile: vi.fn().mockResolvedValue(undefined),
    renameDriveFile: vi.fn().mockResolvedValue({ id: 5, fileId: 812, name: '새이름.pdf' }),
    copyDriveFile: vi.fn().mockResolvedValue({ id: 6, fileId: 813, folderId: 3, name: '보고서.pdf' }),
    copyDriveFolder: vi.fn().mockResolvedValue({ id: 11, parentId: 3, name: '자료' }),
    listDriveFileVersions: vi.fn().mockResolvedValue([]),
    listDriveFileBacklinks: vi.fn().mockResolvedValue([]),
    importAttachmentToDrive: vi.fn().mockResolvedValue({ id: 7, fileId: 900, folderId: null, name: 'a.png' }),
    createDriveDownloadLink: vi.fn().mockResolvedValue({
      url: 'https://w.example/api/v1/public/drive/transfer/dl_abc', expiresAt: '2026-10-13T05:52:00Z', name: '회의 메모.md',
      sizeBytes: 21, mimeType: 'text/markdown', singleUse: true,
    }),
    createDriveUploadLink: vi.fn().mockResolvedValue({
      url: 'https://w.example/api/v1/public/drive/transfer/ul_abc', method: 'PUT', expiresAt: '2026-10-13T06:10:00Z',
      maxBytes: 10485760, name: '결과.md', singleUse: true,
    }),
    createDriveTextFile: vi.fn().mockResolvedValue({ id: 8, folderId: 3, fileId: 901, name: '회의록.md', mimeType: 'text/markdown', versionCount: 1 }),
    updateDriveTextFile: vi.fn().mockResolvedValue({ id: 8, folderId: 3, fileId: 902, name: '회의록.md', mimeType: 'text/markdown', versionCount: 2 }),
    createDriveVersionUploadLink: vi.fn().mockResolvedValue({
      url: 'https://w.example/api/v1/public/drive/transfer/ul_def', method: 'PUT', expiresAt: '2026-10-13T06:10:00Z',
      maxBytes: 10485760, name: '회의록.md', singleUse: true,
    }),
  };
}

const tool = (c: DriveToolClient, name: string) => buildDriveTools(c).find((x) => x.name === name)!;

describe('buildDriveTools', () => {
  it('list_drive_spaces → client.listDriveSpaces()', async () => {
    const c = mockClient();
    // 서버 DriveSpaceResponse 모양 — ownerId(숫자 사용자 ID)는 내보내지 않는다(WP-353).
    vi.mocked(c.listDriveSpaces).mockResolvedValue([
      { id: 1, type: 'TEAM', name: '팀 스페이스', ownerId: 7, role: 'OWNER', archived: false, createdAt: 't' },
    ]);
    const out = await tool(c, 'list_drive_spaces').handler({});
    expect(c.listDriveSpaces).toHaveBeenCalled();
    expect(JSON.parse(resultText(out))).toEqual([{ id: 1, type: 'TEAM', name: '팀 스페이스', role: 'OWNER', archived: false, createdAt: 't' }]);
  });

  it('list_drive_items → 기본 limit 200 에 다음 페이지 확인용 +1 을 얹어 서버에 요청하고, 끝이면 { folders, files } 만 돌려준다 (WP-352)', async () => {
    const c = mockClient();
    const out = await tool(c, 'list_drive_items').handler({ spaceId: 3 });
    expect(c.listDriveItems).toHaveBeenCalledWith(3, undefined, { limit: 201, offset: 0 });
    expect(JSON.parse(resultText(out))).toEqual({ folders: [], files: [] });
  });

  // WP-353: 폴더 행은 자기 folderId 와 상위 폴더 parentId 를 함께 가진다 — 하위로 내려갈 때 어느 값을 넘기는지 설명이 못 박는다.
  it('폴더를 입력으로 받는 도구 설명이 그 폴더의 folderId 를 쓰라고 안내한다', () => {
    const c = mockClient();
    expect(tool(c, 'list_drive_items').description).toContain('parentId (a folderId, not a row parentId)');
    expect(tool(c, 'create_drive_folder').description).toContain('parentId (a folderId)');
    expect(tool(c, 'move_drive_item').description).toContain('targetFolderId (a folderId)');
  });

  it('list_drive_items → parentId·offset 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'list_drive_items').handler({ spaceId: 3, parentId: 8, limit: 10, offset: 20 });
    expect(c.listDriveItems).toHaveBeenCalledWith(3, 8, { limit: 11, offset: 20 });
  });

  it('list_drive_items → 한 건이 더 오면 limit 까지만 담고 hasMore·nextOffset 을 알린다 (WP-352)', async () => {
    const c = mockClient();
    const file = (id: number) => ({ id, fileId: 900 + id, name: `f${id}` });
    // limit 3: 폴더 2 + 파일 2(= 4건, 한 건 초과) → 폴더 2 + 파일 1 만 담고 nextOffset = offset(5) + 3.
    vi.mocked(c.listDriveItems).mockResolvedValue({
      folders: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      files: [file(1), file(2)],
    });
    const out = JSON.parse(resultText(await tool(c, 'list_drive_items').handler({ spaceId: 3, limit: 3, offset: 5 })));
    expect(out.folders).toHaveLength(2);
    expect(out.files).toEqual([{ driveFileId: 1, name: 'f1' }]);
    expect(out.hasMore).toBe(true);
    expect(out.nextOffset).toBe(8);
  });

  it('list_drive_items → 폴더만으로 limit 을 넘으면 파일 없이 폴더를 limit 개로 자른다', async () => {
    const c = mockClient();
    vi.mocked(c.listDriveItems).mockResolvedValue({ folders: [{ id: 1 }, { id: 2 }, { id: 3 }], files: [] });
    const out = JSON.parse(resultText(await tool(c, 'list_drive_items').handler({ spaceId: 3, limit: 2 })));
    expect(out).toEqual({ folders: [{ folderId: 1 }, { folderId: 2 }], files: [], hasMore: true, nextOffset: 2 });
  });

  it('list_drive_items 는 limit 상한(500)을 넘으면 거부하고 설명에 이어 읽기 안내를 둔다', async () => {
    const c = mockClient();
    await expect(tool(c, 'list_drive_items').handler({ spaceId: 3, limit: 501 })).rejects.toThrow();
    expect(tool(c, 'list_drive_items').description).toContain('nextOffset');
  });

  it('list_drive_items 는 파일 행에서 core fileId 를 제거하고 drive_file.id 를 driveFileId 로 노출한다 (#840)', async () => {
    const c = mockClient();
    vi.mocked(c.listDriveItems).mockResolvedValue({
      folders: [{ id: 3, parentId: null, name: '폴더', createdAt: 't' }],
      files: [
        {
          id: 5,
          folderId: 3,
          fileId: 812,
          name: '보고서.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          category: 'DOCUMENT',
          createdAt: 't',
          updatedAt: 'u',
          versionCount: 2,
          available: false,
        },
      ],
    });
    const out = JSON.parse(resultText(await tool(c, 'list_drive_items').handler({ spaceId: 1 })));
    expect(out.folders).toEqual([{ folderId: 3, parentId: null, name: '폴더', createdAt: 't' }]);
    // fileId 외 필드(원본 유실 available 등)는 그대로 전달돼야 한다.
    expect(out.files[0]).toEqual({
      driveFileId: 5,
      folderId: 3,
      name: '보고서.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      category: 'DOCUMENT',
      createdAt: 't',
      updatedAt: 'u',
      versionCount: 2,
      available: false,
    });
    expect(JSON.stringify(out)).not.toContain('812');
  });

  it('search_drive → client.searchDrive(spaceId, q) 후 driveFileId 뷰로 반환 (#840)', async () => {
    const c = mockClient();
    vi.mocked(c.searchDrive).mockResolvedValue({ folders: [], files: [{ id: 1, fileId: 99, name: 'a.pdf' }] });
    const out = await tool(c, 'search_drive').handler({ spaceId: 3, q: '보고서' });
    expect(c.searchDrive).toHaveBeenCalledWith(3, '보고서');
    expect(JSON.parse(resultText(out))).toEqual({ folders: [], files: [{ driveFileId: 1, name: 'a.pdf' }] });
  });

  it('search_drive → 도구 limit(기본 50)을 넘으면 각각 limit 개로 자르고 truncated 를 알린다 (WP-352)', async () => {
    const c = mockClient();
    const files = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, fileId: 900 + i, name: `f${i}` }));
    vi.mocked(c.searchDrive).mockResolvedValue({ folders: [{ id: 1, name: 'd' }], files });
    const out = JSON.parse(resultText(await tool(c, 'search_drive').handler({ spaceId: 3, q: 'f' })));
    expect(out.files).toHaveLength(50);
    expect(out.folders).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  it('search_drive → 서버 상한(200)에 닿으면 limit 을 최대로 줘도 truncated 를 알린다 (WP-352)', async () => {
    const c = mockClient();
    const folders = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `d${i}` }));
    vi.mocked(c.searchDrive).mockResolvedValue({ folders, files: [] });
    const out = JSON.parse(resultText(await tool(c, 'search_drive').handler({ spaceId: 3, q: 'd', limit: 200 })));
    expect(out.folders).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });

  it('search_drive → 상한 안이면 truncated 키가 없다 (WP-352)', async () => {
    const c = mockClient();
    vi.mocked(c.searchDrive).mockResolvedValue({ folders: [{ id: 1, name: 'd' }], files: [{ id: 2, fileId: 9, name: 'a' }] });
    const out = JSON.parse(resultText(await tool(c, 'search_drive').handler({ spaceId: 3, q: 'a' })));
    expect(out).not.toHaveProperty('truncated');
    // 폴더는 folderId, 파일은 driveFileId 로만 가리킨다(WP-353).
    expect(out.folders).toEqual([{ folderId: 1, name: 'd' }]);
    expect(out.files).toEqual([{ driveFileId: 2, name: 'a' }]);
  });

  it('search_drive 는 q 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'search_drive').handler({ spaceId: 3 })).rejects.toThrow();
    expect(c.searchDrive).not.toHaveBeenCalled();
  });

  it('get_drive_file_summary → client.getDriveFileSummary(driveFileId), 미완료 status·reason 을 그대로 전달 (#850)', async () => {
    const c = mockClient();
    vi.mocked(c.getDriveFileSummary).mockResolvedValue({ summary: null, status: 'FAILED', reason: '암호화된 PDF' });
    const out = await tool(c, 'get_drive_file_summary').handler({ driveFileId: 5 });
    expect(c.getDriveFileSummary).toHaveBeenCalledWith(5);
    expect(JSON.parse(resultText(out))).toEqual({ summary: null, status: 'FAILED', reason: '암호화된 PDF' });
  });

  // WP-354: 버전·백링크는 별도 도구가 아니라 옵션 — 켜지 않으면 추가 요청이 없고 응답 모양도 그대로다.
  it('get_drive_file_summary → 옵션이 없으면 버전·백링크를 요청하지 않는다', async () => {
    const c = mockClient();
    await tool(c, 'get_drive_file_summary').handler({ driveFileId: 5 });
    expect(c.listDriveFileVersions).not.toHaveBeenCalled();
    expect(c.listDriveFileBacklinks).not.toHaveBeenCalled();
  });

  it('get_drive_file_summary → includeVersions 는 업로더 숫자 ID·core fileId 를 지운 버전 목록을 싣는다 (WP-354)', async () => {
    const c = mockClient();
    vi.mocked(c.listDriveFileVersions).mockResolvedValue([
      { versionNo: 2, fileId: 901, sizeBytes: 200, uploadedBy: 7, uploadedByName: '김하나', createdAt: 't2', comment: null, current: true },
      { versionNo: 1, fileId: 900, sizeBytes: 100, uploadedBy: 7, uploadedByName: '김하나', createdAt: 't1', comment: '최초', current: false },
    ]);
    const out = JSON.parse(resultText(await tool(c, 'get_drive_file_summary').handler({ driveFileId: 5, includeVersions: true, includeBacklinks: null })));
    expect(c.listDriveFileVersions).toHaveBeenCalledWith(5);
    expect(c.listDriveFileBacklinks).not.toHaveBeenCalled();
    expect(out.versions).toEqual([
      { versionNo: 2, sizeBytes: 200, uploadedByName: '김하나', createdAt: 't2', current: true },
      { versionNo: 1, sizeBytes: 100, uploadedByName: '김하나', createdAt: 't1', comment: '최초' },
    ]);
    expect(out.backlinks).toBeUndefined();
  });

  it('get_drive_file_summary → includeBacklinks 는 내부 sourceId 를 뺀 백링크를 싣고, 요약 필드와 함께 돌려준다 (WP-354)', async () => {
    const c = mockClient();
    vi.mocked(c.getDriveFileSummary).mockResolvedValue({ summary: '요약', status: 'DONE' });
    vi.mocked(c.listDriveFileBacklinks).mockResolvedValue([
      { sourceType: 'ISSUE', sourceId: 41, label: 'WP-12 제목', deepLink: '/projects/WP/issues/12' },
    ]);
    const out = JSON.parse(resultText(await tool(c, 'get_drive_file_summary').handler({ driveFileId: 5, includeBacklinks: true })));
    expect(out).toEqual({ summary: '요약', status: 'DONE', backlinks: [{ sourceType: 'ISSUE', label: 'WP-12 제목', deepLink: '/projects/WP/issues/12' }] });
  });

  it('search_drive_content → query 를 q 로 옮기고 limit 기본 10, hit 의 core fileId 는 제거 (#840, #850)', async () => {
    const c = mockClient();
    vi.mocked(c.searchDriveContent).mockResolvedValue({
      hits: [{ driveFileId: 5, fileId: 812, spaceId: 1, spaceName: '팀', name: 'Q3 보고서.pdf', snippet: '매출', score: 0.9 }],
      semantic: true,
    });
    const out = JSON.parse(resultText(await tool(c, 'search_drive_content').handler({ query: '매출' })));
    expect(c.searchDriveContent).toHaveBeenCalledWith({ q: '매출', spaceId: undefined, limit: 10 });
    expect(out).toEqual({
      hits: [{ driveFileId: 5, spaceId: 1, spaceName: '팀', name: 'Q3 보고서.pdf', snippet: '매출', score: 0.9 }],
      semantic: true,
    });
    expect(JSON.stringify(out)).not.toContain('812');
  });

  it('search_drive_content 는 spaceId·limit 를 그대로 전달하고 limit 50 초과는 거부한다', async () => {
    const c = mockClient();
    await tool(c, 'search_drive_content').handler({ query: '계약', spaceId: 2, limit: 30 });
    expect(c.searchDriveContent).toHaveBeenCalledWith({ q: '계약', spaceId: 2, limit: 30 });
    await expect(tool(c, 'search_drive_content').handler({ query: '계약', limit: 51 })).rejects.toThrow();
  });
});

describe('휴지통 (#854)', () => {
  it('list_drive_trash → 파일은 driveFileId, 폴더는 folderId 로만 id 를 노출한다', async () => {
    const c = mockClient();
    vi.mocked(c.listDriveTrash).mockResolvedValue([
      { type: 'FILE', id: 5, name: 'a.pdf', originalPath: '/문서' },
      { type: 'FOLDER', id: 5, name: '보관', originalPath: '/' },
    ]);
    const out = JSON.parse(resultText(await tool(c, 'list_drive_trash').handler({ spaceId: 2 })));
    expect(c.listDriveTrash).toHaveBeenCalledWith(2);
    expect(out).toEqual([
      { type: 'FILE', driveFileId: 5, name: 'a.pdf', originalPath: '/문서' },
      { type: 'FOLDER', folderId: 5, name: '보관', originalPath: '/' },
    ]);
  });

  it('restore_drive_item → driveFileId 면 파일, folderId 면 폴더 복원', async () => {
    const c = mockClient();
    await tool(c, 'restore_drive_item').handler({ driveFileId: 5 });
    await tool(c, 'restore_drive_item').handler({ folderId: 6 });
    expect(c.restoreDriveFile).toHaveBeenCalledWith(5);
    expect(c.restoreDriveFolder).toHaveBeenCalledWith(6);
  });

  it('restore_drive_item → 둘 다 주거나 둘 다 없으면 거절(시퀀스가 달라 모호하다)', async () => {
    const c = mockClient();
    await expect(tool(c, 'restore_drive_item').handler({ driveFileId: 5, folderId: 6 })).rejects.toThrow();
    await expect(tool(c, 'restore_drive_item').handler({})).rejects.toThrow();
    expect(c.restoreDriveFile).not.toHaveBeenCalled();
    expect(c.restoreDriveFolder).not.toHaveBeenCalled();
  });
});

describe('폴더·파일 정리 (#333 M4, #840, WP-343)', () => {
  it('create_drive_folder → parentId 생략 시 null(루트)로 넘기고 생성된 폴더를 JSON 으로 반환', async () => {
    const c = mockClient();
    const out = await tool(c, 'create_drive_folder').handler({ spaceId: 1, name: '신규폴더' });
    expect(c.createDriveFolder).toHaveBeenCalledWith(1, null, '신규폴더');
    expect(JSON.parse(resultText(out))).toEqual({ folderId: 10, name: '신규폴더' });
  });

  it('create_drive_folder → parentId 지정 시 그대로, 빈 이름·비양수 id 는 거절', async () => {
    const c = mockClient();
    await tool(c, 'create_drive_folder').handler({ spaceId: 1, parentId: 5, name: '하위' });
    expect(c.createDriveFolder).toHaveBeenCalledWith(1, 5, '하위');
    await expect(tool(c, 'create_drive_folder').handler({ spaceId: 1, name: '' })).rejects.toThrow();
    await expect(tool(c, 'create_drive_folder').handler({ spaceId: 0, name: 'x' })).rejects.toThrow();
  });

  // WP-369: 파일·폴더 이름변경은 rename_drive_item 하나 — driveFileId 면 파일, folderId 면 폴더 API 로 보낸다.
  it('rename_drive_item → folderId 면 renameDriveFolder 결과를 folderId 뷰로 반환', async () => {
    const c = mockClient();
    const out = await tool(c, 'rename_drive_item').handler({ folderId: 4, name: '새이름' });
    expect(c.renameDriveFolder).toHaveBeenCalledWith(4, '새이름');
    expect(c.renameDriveFile).not.toHaveBeenCalled();
    expect(JSON.parse(resultText(out))).toEqual({ folderId: 4, name: '새이름' });
  });

  it('rename_drive_item → driveFileId 면 renameDriveFile 결과를 driveFileId 뷰(core fileId 제거)로 반환 (WP-354)', async () => {
    const c = mockClient();
    const out = await tool(c, 'rename_drive_item').handler({ driveFileId: 5, name: '새이름.pdf' });
    expect(c.renameDriveFile).toHaveBeenCalledWith(5, '새이름.pdf');
    expect(c.renameDriveFolder).not.toHaveBeenCalled();
    expect(JSON.parse(resultText(out))).toEqual({ driveFileId: 5, name: '새이름.pdf' });
    await expect(tool(c, 'rename_drive_item').handler({ driveFileId: 5, name: '' })).rejects.toThrow();
  });

  it('rename_drive_item → driveFileId·folderId 를 둘 다 주거나 둘 다 빼면 거부하고 서버를 부르지 않는다', async () => {
    const c = mockClient();
    await expect(tool(c, 'rename_drive_item').handler({ driveFileId: 5, folderId: 4, name: 'x' })).rejects.toThrow(/정확히 하나/);
    await expect(tool(c, 'rename_drive_item').handler({ name: 'x' })).rejects.toThrow(/정확히 하나/);
    expect(c.renameDriveFile).not.toHaveBeenCalled();
    expect(c.renameDriveFolder).not.toHaveBeenCalled();
  });

  // WP-369: 이동도 move_drive_item 하나 — 대상은 파일·폴더 모두 targetFolderId 이고, 폴더 이동 API 의 targetParentId 로 옮겨 담는다.
  it('move_drive_item → folderId 면 moveDriveFolder(folderId, targetFolderId), 대상 생략·null 은 루트(null)', async () => {
    const c = mockClient();
    expect(await tool(c, 'move_drive_item').handler({ folderId: 4 })).toBe('ok');
    expect(c.moveDriveFolder).toHaveBeenCalledWith(4, null);
    await tool(c, 'move_drive_item').handler({ folderId: 4, targetFolderId: 9 });
    expect(c.moveDriveFolder).toHaveBeenLastCalledWith(4, 9);
    await tool(c, 'move_drive_item').handler({ folderId: 4, targetFolderId: null });
    expect(c.moveDriveFolder).toHaveBeenLastCalledWith(4, null);
    expect(c.moveDriveFile).not.toHaveBeenCalled();
  });

  it('move_drive_item → driveFileId 면 moveDriveFile, 옛 fileId·targetParentId 파라미터만으로는 거부한다(#840)', async () => {
    const c = mockClient();
    expect(await tool(c, 'move_drive_item').handler({ driveFileId: 5, targetFolderId: 3 })).toBe('ok');
    expect(c.moveDriveFile).toHaveBeenCalledWith(5, 3);
    await tool(c, 'move_drive_item').handler({ driveFileId: 5 });
    expect(c.moveDriveFile).toHaveBeenLastCalledWith(5, null);
    expect(c.moveDriveFolder).not.toHaveBeenCalled();
    await expect(tool(c, 'move_drive_item').handler({ fileId: 812, targetFolderId: 3 })).rejects.toThrow(/정확히 하나/);
    await expect(tool(c, 'move_drive_item').handler({ driveFileId: 5, folderId: 4 })).rejects.toThrow(/정확히 하나/);
  });

  it('copy_drive_item → driveFileId 면 파일 복사, folderId 면 폴더 복사, 대상 생략·null 은 루트(null) (WP-354)', async () => {
    const c = mockClient();
    const file = await tool(c, 'copy_drive_item').handler({ driveFileId: 5, targetFolderId: 3 });
    expect(c.copyDriveFile).toHaveBeenCalledWith(5, 3);
    expect(JSON.parse(resultText(file))).toEqual({ driveFileId: 6, folderId: 3, name: '보고서.pdf' });
    const folder = await tool(c, 'copy_drive_item').handler({ folderId: 8 });
    expect(c.copyDriveFolder).toHaveBeenCalledWith(8, null);
    expect(JSON.parse(resultText(folder))).toEqual({ folderId: 11, parentId: 3, name: '자료' });
    await tool(c, 'copy_drive_item').handler({ folderId: 8, targetFolderId: null });
    expect(c.copyDriveFolder).toHaveBeenLastCalledWith(8, null);
  });

  it('copy_drive_item → 둘 다 주거나 둘 다 없으면 거절(시퀀스가 달라 모호하다)', async () => {
    const c = mockClient();
    await expect(tool(c, 'copy_drive_item').handler({ driveFileId: 5, folderId: 8 })).rejects.toThrow();
    await expect(tool(c, 'copy_drive_item').handler({ targetFolderId: 3 })).rejects.toThrow();
    expect(c.copyDriveFile).not.toHaveBeenCalled();
    expect(c.copyDriveFolder).not.toHaveBeenCalled();
  });

  // WP-369: 모델이 쓰지 않는 id 를 null 로 채워 보내도 생략과 같다 — 분기가 !== undefined 였다면 {driveFileId:null, folderId:4} 가 /files/null 로 갔다.
  it('파일·폴더 도구 4개는 null 인 id 를 생략으로 보고 남은 쪽 엔드포인트로 보낸다', async () => {
    const c = mockClient();
    await tool(c, 'restore_drive_item').handler({ driveFileId: null, folderId: 4 });
    expect(c.restoreDriveFolder).toHaveBeenCalledWith(4);
    await tool(c, 'restore_drive_item').handler({ driveFileId: 5, folderId: null });
    expect(c.restoreDriveFile).toHaveBeenCalledWith(5);
    await tool(c, 'rename_drive_item').handler({ driveFileId: null, folderId: 4, name: '새이름' });
    expect(c.renameDriveFolder).toHaveBeenCalledWith(4, '새이름');
    await tool(c, 'rename_drive_item').handler({ driveFileId: 5, folderId: null, name: '새이름.pdf' });
    expect(c.renameDriveFile).toHaveBeenCalledWith(5, '새이름.pdf');
    await tool(c, 'move_drive_item').handler({ driveFileId: null, folderId: 4, targetFolderId: 9 });
    expect(c.moveDriveFolder).toHaveBeenCalledWith(4, 9);
    await tool(c, 'move_drive_item').handler({ driveFileId: 5, folderId: null, targetFolderId: null });
    expect(c.moveDriveFile).toHaveBeenCalledWith(5, null);
    await tool(c, 'copy_drive_item').handler({ driveFileId: null, folderId: 8, targetFolderId: 3 });
    expect(c.copyDriveFolder).toHaveBeenCalledWith(8, 3);
    await tool(c, 'copy_drive_item').handler({ driveFileId: 5, folderId: null });
    expect(c.copyDriveFile).toHaveBeenCalledWith(5, null);
    // 둘 다 null 이면 둘 다 없는 것과 같다 — 거절하고 서버를 부르지 않는다.
    await expect(tool(c, 'restore_drive_item').handler({ driveFileId: null, folderId: null })).rejects.toThrow(/정확히 하나/);
    for (const m of [c.restoreDriveFile, c.restoreDriveFolder, c.renameDriveFile, c.renameDriveFolder, c.moveDriveFile, c.moveDriveFolder, c.copyDriveFile, c.copyDriveFolder]) {
      expect(m).toHaveBeenCalledTimes(1);
    }
  });

  it('import_attachment_to_drive → 폴더 생략·null 은 루트(null)로 넘기고 가져온 파일을 driveFileId 뷰로 반환 (WP-354)', async () => {
    const c = mockClient();
    const out = await tool(c, 'import_attachment_to_drive').handler({ spaceId: 2, attachmentId: 900 });
    expect(c.importAttachmentToDrive).toHaveBeenCalledWith(2, null, 900);
    expect(JSON.parse(resultText(out))).toEqual({ driveFileId: 7, folderId: null, name: 'a.png' });
    await tool(c, 'import_attachment_to_drive').handler({ spaceId: 2, attachmentId: 900, folderId: 4 });
    expect(c.importAttachmentToDrive).toHaveBeenLastCalledWith(2, 4, 900);
    await expect(tool(c, 'import_attachment_to_drive').handler({ spaceId: 2 })).rejects.toThrow();
  });
});

// WP-369: 전송 링크·파일 올리기. 바이트는 MCP 를 거치지 않는다 — 링크를 받은 쪽(curl·브라우저)이 공개 경로로 주고받는다.
describe('전송 링크·파일 올리기 (WP-369)', () => {
  it('create_drive_download_link → createDriveDownloadLink(driveFileId) 응답에서 링크 필드 6개만 골라 돌려준다', async () => {
    const c = mockClient();
    // 서버에 나중에 생길 수 있는 필드(발급자·내부 id)는 로그인 없는 링크와 함께 밖으로 나가지 않게 허용 목록으로 버린다.
    vi.mocked(c.createDriveDownloadLink).mockResolvedValueOnce({
      url: 'https://w.example/api/v1/public/drive/transfer/dl_abc', expiresAt: '2026-10-13T05:52:00Z', name: '회의 메모.md',
      sizeBytes: 21, mimeType: 'text/markdown', singleUse: true, transferLinkId: 77, createdById: 9,
    } as never);
    const out = await tool(c, 'create_drive_download_link').handler({ driveFileId: 5 });
    expect(c.createDriveDownloadLink).toHaveBeenCalledWith(5);
    expect(JSON.parse(resultText(out))).toEqual({
      url: 'https://w.example/api/v1/public/drive/transfer/dl_abc', expiresAt: '2026-10-13T05:52:00Z', name: '회의 메모.md',
      sizeBytes: 21, mimeType: 'text/markdown', singleUse: true,
    });
    await expect(tool(c, 'create_drive_download_link').handler({ fileId: 5 })).rejects.toThrow();
  });

  it('create_drive_file content 모드 → createDriveTextFile 결과를 driveFileId 뷰(core fileId 제거)로, 업로드 링크는 만들지 않는다', async () => {
    const c = mockClient();
    const out = await tool(c, 'create_drive_file').handler({ spaceId: 2, folderId: 3, name: '회의록.md', content: '# 회의록' });
    expect(c.createDriveTextFile).toHaveBeenCalledWith(2, 3, '회의록.md', '# 회의록');
    expect(c.createDriveUploadLink).not.toHaveBeenCalled();
    expect(JSON.parse(resultText(out))).toEqual({ driveFileId: 8, folderId: 3, name: '회의록.md', mimeType: 'text/markdown', versionCount: 1 });
  });

  // 서버는 빈 content 를 받는다(빈 파일) — 진릿값으로 가르면 빈 문자열이 업로드 링크 발급으로 새어 나간다.
  it('create_drive_file 빈 문자열 content 도 content 모드다(빈 파일), 폴더 생략은 루트(null)', async () => {
    const c = mockClient();
    await tool(c, 'create_drive_file').handler({ spaceId: 2, name: '빈.txt', content: '' });
    expect(c.createDriveTextFile).toHaveBeenCalledWith(2, null, '빈.txt', '');
    expect(c.createDriveUploadLink).not.toHaveBeenCalled();
  });

  it('create_drive_file 링크 모드(content 생략·null) → 업로드 링크를 uploadUrl·howTo 뷰로 돌려준다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await tool(c, 'create_drive_file').handler({ spaceId: 2, name: '결과.md' })));
    expect(c.createDriveUploadLink).toHaveBeenCalledWith(2, null, '결과.md');
    expect(c.createDriveTextFile).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      uploadUrl: 'https://w.example/api/v1/public/drive/transfer/ul_abc', method: 'PUT', expiresAt: '2026-10-13T06:10:00Z',
      maxBytes: 10485760, name: '결과.md', singleUse: true,
      howTo: 'curl -T <local file> "https://w.example/api/v1/public/drive/transfer/ul_abc"',
    });
    // url 은 uploadUrl 로만 준다(다운로드 링크의 url 과 헷갈리지 않게). 안내는 한 번만·Content-Type 금지·새 링크를 말한다.
    expect(out).not.toHaveProperty('url');
    expect(out.note).toMatch(/한 번만/);
    expect(out.note).toMatch(/Content-Type/);
    expect(out.note).toMatch(/새 링크/);
    await tool(c, 'create_drive_file').handler({ spaceId: 2, folderId: 4, name: '결과.md', content: null });
    expect(c.createDriveUploadLink).toHaveBeenLastCalledWith(2, 4, '결과.md');
    expect(c.createDriveTextFile).not.toHaveBeenCalled();
  });

  it('업로드 링크 뷰는 허용 목록 — 서버에 새 필드(발급자 id 등)가 생겨도 내보내지 않는다(WP-369 최종 리뷰 M4)', async () => {
    const c = mockClient();
    const server = {
      url: 'https://w.example/api/v1/public/drive/transfer/ul_abc', method: 'PUT', expiresAt: '2026-10-13T06:10:00Z',
      maxBytes: 10485760, name: '결과.md', singleUse: true, userId: 77, tokenHash: 'abc',
    };
    vi.mocked(c.createDriveUploadLink).mockResolvedValue(server as never);
    vi.mocked(c.createDriveVersionUploadLink).mockResolvedValue(server as never);
    for (const args of [{ spaceId: 2, name: '결과.md' }, { driveFileId: 8 }]) {
      const out = JSON.parse(resultText(await tool(c, 'create_drive_file').handler(args)));
      expect(Object.keys(out).sort()).toEqual(['expiresAt', 'howTo', 'maxBytes', 'method', 'name', 'note', 'singleUse', 'uploadUrl']);
    }
  });

  it('create_drive_file 은 이름이 비었거나 spaceId 가 없으면 거부하고 서버를 부르지 않는다', async () => {
    const c = mockClient();
    await expect(tool(c, 'create_drive_file').handler({ spaceId: 2, name: '', content: 'x' })).rejects.toThrow();
    await expect(tool(c, 'create_drive_file').handler({ name: 'a.md' })).rejects.toThrow(/spaceId 와 name/);
    await expect(tool(c, 'create_drive_file').handler({ spaceId: 2 })).rejects.toThrow(/spaceId 와 name/);
    await expect(tool(c, 'create_drive_file').handler({ spaceId: 2, name: null, content: 'x' })).rejects.toThrow(/spaceId 와 name/);
    expect(c.createDriveTextFile).not.toHaveBeenCalled();
    expect(c.createDriveUploadLink).not.toHaveBeenCalled();
  });

  // WP-369 Task 3: driveFileId 면 그 파일의 새 버전 — content 는 POST /files/{id}/text, 없으면 그 파일에 묶인 업로드 링크.
  it('create_drive_file driveFileId+content → updateDriveTextFile 결과를 driveFileId 뷰로, 새 파일·링크는 만들지 않는다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await tool(c, 'create_drive_file').handler({ driveFileId: 8, content: '# 고친 회의록' })));
    expect(c.updateDriveTextFile).toHaveBeenCalledWith(8, '# 고친 회의록');
    expect(out).toEqual({ driveFileId: 8, folderId: 3, name: '회의록.md', mimeType: 'text/markdown', versionCount: 2 });
    // 빈 문자열도 content 다(파일을 비운 새 버전). 쓰지 않는 spaceId·folderId·name 의 null 은 생략과 같다.
    await tool(c, 'create_drive_file').handler({ driveFileId: 8, content: '', spaceId: null, folderId: null, name: null });
    expect(c.updateDriveTextFile).toHaveBeenLastCalledWith(8, '');
    for (const m of [c.createDriveTextFile, c.createDriveUploadLink, c.createDriveVersionUploadLink]) expect(m).not.toHaveBeenCalled();
  });

  it('create_drive_file driveFileId 만 → 그 파일에 묶인 업로드 링크를 같은 뷰로, note 는 이 파일의 새 버전·같은 종류·같은 driveFileId 재발급을 말한다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await tool(c, 'create_drive_file').handler({ driveFileId: 8, content: null })));
    expect(c.createDriveVersionUploadLink).toHaveBeenCalledWith(8);
    expect(out).toMatchObject({
      uploadUrl: 'https://w.example/api/v1/public/drive/transfer/ul_def', method: 'PUT', maxBytes: 10485760, name: '회의록.md', singleUse: true,
      howTo: 'curl -T <local file> "https://w.example/api/v1/public/drive/transfer/ul_def"',
    });
    expect(out).not.toHaveProperty('url');
    expect(out.note).toMatch(/한 번만/);
    expect(out.note).toMatch(/Content-Type/);
    expect(out.note).toMatch(/driveFileId 8\)의 새 버전/);
    expect(out.note).toMatch(/같은 종류의 파일/);
    expect(out.note).toMatch(/같은 driveFileId 로 새 링크/);
    // 이름 기반 링크의 "같은 이름이면 새 버전" 안내는 파일에 묶인 링크에는 맞지 않는다.
    expect(out.note).not.toMatch(/같은 이름의 파일이 있으면/);
    for (const m of [c.createDriveTextFile, c.createDriveUploadLink, c.updateDriveTextFile]) expect(m).not.toHaveBeenCalled();
  });

  // driveFileId 는 위치·이름을 바꾸지 않는다 — name 을 함께 주면 이름변경으로 오해한 것이라 거절한다(rename_drive_item 이 따로 있다).
  it('create_drive_file 은 driveFileId 와 spaceId·folderId·name 을 함께 주면 거부하고 서버를 부르지 않는다', async () => {
    const c = mockClient();
    for (const extra of [{ spaceId: 2 }, { folderId: 3 }, { name: '새이름.md' }]) {
      await expect(tool(c, 'create_drive_file').handler({ driveFileId: 8, content: 'x', ...extra })).rejects.toThrow(/driveFileId/);
    }
    await expect(tool(c, 'create_drive_file').handler({ driveFileId: 0, content: 'x' })).rejects.toThrow();
    for (const m of [c.createDriveTextFile, c.createDriveUploadLink, c.updateDriveTextFile, c.createDriveVersionUploadLink]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  // 설명이 모델이 찾을 낱말(upload·download)과 외부 클라이언트가 지켜야 할 사실을 담는다(R1·R10, 1b 결과).
  it('설명에 upload·download 낱말, 10분·한 번만·새 링크, curl 사용법, 웹 업로드 안내가 있다', () => {
    const c = mockClient();
    const dl = tool(c, 'create_drive_download_link').description;
    expect(dl.split('.')[0]).toMatch(/download/);
    // 이름에 공백이 있어도(예: 회의 메모.md) 셸이 한 인자로 받도록 따옴표로 감싼 형태를 알려 준다.
    for (const s of ['10 minutes', 'no login', 'show it only to the user', 'Works once', 'new link', 'curl -o "<name>" "<url>"', 'read_file']) {
      expect(dl).toContain(s);
    }
    const up = tool(c, 'create_drive_file').description;
    expect(up.split('.')[0]).toMatch(/Uploads/);
    for (const s of ['new version', 'content', 'one-time upload link', '10 minutes', 'maxBytes', 'curl -T <file> "<uploadUrl>"', 'no -H Content-Type', 'new link', 'web drive']) {
      expect(up).toContain(s);
    }
    // WP-369 Task 3: driveFileId 는 그 파일의 새 버전(이름·폴더 그대로), 텍스트 갱신은 텍스트 파일만, 링크로는 같은 종류의 파일.
    for (const s of ['spaceId+name', 'new version of driveFileId', 'same name and folder', 'driveFileId must be a text file', 'for driveFileId, the same file type']) {
      expect(up).toContain(s);
    }
  });
});
