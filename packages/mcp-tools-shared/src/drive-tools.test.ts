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
    expect(tool(c, 'move_drive_folder').description).toContain('the folderId of the new parent, not a row parentId');
    expect(tool(c, 'move_drive_file').description).toContain('targetFolderId (a folderId)');
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

  it('rename_drive_folder → client.renameDriveFolder(folderId, name) 결과를 JSON 으로 반환', async () => {
    const c = mockClient();
    const out = await tool(c, 'rename_drive_folder').handler({ folderId: 4, name: '새이름' });
    expect(c.renameDriveFolder).toHaveBeenCalledWith(4, '새이름');
    expect(JSON.parse(resultText(out))).toEqual({ folderId: 4, name: '새이름' });
  });

  it('move_drive_folder → targetParentId 생략 시 루트(null)로 이동하고 ok', async () => {
    const c = mockClient();
    expect(await tool(c, 'move_drive_folder').handler({ folderId: 4 })).toBe('ok');
    expect(c.moveDriveFolder).toHaveBeenCalledWith(4, null);
    await tool(c, 'move_drive_folder').handler({ folderId: 4, targetParentId: 9 });
    expect(c.moveDriveFolder).toHaveBeenLastCalledWith(4, 9);
  });

  it('move_drive_file → driveFileId 를 넘기고, 옛 fileId 파라미터는 거부한다(#840)', async () => {
    const c = mockClient();
    expect(await tool(c, 'move_drive_file').handler({ driveFileId: 5, targetFolderId: 3 })).toBe('ok');
    expect(c.moveDriveFile).toHaveBeenCalledWith(5, 3);
    await tool(c, 'move_drive_file').handler({ driveFileId: 5 });
    expect(c.moveDriveFile).toHaveBeenLastCalledWith(5, null);
    await expect(tool(c, 'move_drive_file').handler({ fileId: 812, targetFolderId: 3 })).rejects.toThrow();
  });
});
