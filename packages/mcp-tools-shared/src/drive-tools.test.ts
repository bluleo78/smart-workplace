import { describe, expect, it, vi } from 'vitest';
import { buildDriveTools } from './drive-tools.js';
import type { DriveToolClient } from './tool-client.js';

/** 드라이브 클라이언트 mock. */
function mockClient(): DriveToolClient {
  return {
    listDriveSpaces: vi.fn().mockResolvedValue([]),
    listDriveItems: vi.fn().mockResolvedValue({ folders: [], files: [] }),
    searchDrive: vi.fn().mockResolvedValue({ folders: [], files: [] }),
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
});
