import { describe, expect, it, vi } from 'vitest';
import { buildDriveTools } from './drive-tools.js';
import type { DriveToolClient } from './tool-client.js';

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
  };
}

const tool = (c: DriveToolClient, name: string) => buildDriveTools(c).find((x) => x.name === name)!;

describe('buildDriveTools', () => {
  it('list_drive_spaces → client.listDriveSpaces()', async () => {
    const c = mockClient();
    vi.mocked(c.listDriveSpaces).mockResolvedValue([{ id: 1, name: '팀 스페이스' }]);
    const out = await tool(c, 'list_drive_spaces').handler({});
    expect(c.listDriveSpaces).toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual([{ id: 1, name: '팀 스페이스' }]);
  });

  it('list_drive_items → parentId 생략 시 undefined 로 client.listDriveItems 호출', async () => {
    const c = mockClient();
    const out = await tool(c, 'list_drive_items').handler({ spaceId: 3 });
    expect(c.listDriveItems).toHaveBeenCalledWith(3, undefined);
    expect(JSON.parse(out)).toEqual({ folders: [], files: [] });
  });

  it('list_drive_items → parentId 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'list_drive_items').handler({ spaceId: 3, parentId: 8 });
    expect(c.listDriveItems).toHaveBeenCalledWith(3, 8);
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
    const out = JSON.parse(await tool(c, 'list_drive_items').handler({ spaceId: 1 }));
    expect(out.folders).toEqual([{ id: 3, parentId: null, name: '폴더', createdAt: 't' }]);
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
    expect(JSON.parse(out)).toEqual({ folders: [], files: [{ driveFileId: 1, name: 'a.pdf' }] });
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
    expect(JSON.parse(out)).toEqual({ summary: null, status: 'FAILED', reason: '암호화된 PDF' });
  });

  it('search_drive_content → query 를 q 로 옮기고 limit 기본 10, hit 의 core fileId 는 제거 (#840, #850)', async () => {
    const c = mockClient();
    vi.mocked(c.searchDriveContent).mockResolvedValue({
      hits: [{ driveFileId: 5, fileId: 812, spaceId: 1, spaceName: '팀', name: 'Q3 보고서.pdf', snippet: '매출', score: 0.9 }],
      semantic: true,
    });
    const out = JSON.parse(await tool(c, 'search_drive_content').handler({ query: '매출' }));
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
    const out = JSON.parse(await tool(c, 'list_drive_trash').handler({ spaceId: 2 }));
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
