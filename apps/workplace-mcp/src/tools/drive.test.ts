import { describe, expect, it, vi } from 'vitest';
import { mockPatApiClient as mockClient } from './test-support.js';
import { buildDriveTools } from './drive.js';

describe('buildDriveTools', () => {
  it('list_drive_spaces → client.listDriveSpaces()', async () => {
    const c = mockClient();
    (c.listDriveSpaces as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: '팀 스페이스' }]);
    const t = buildDriveTools(c).find((x) => x.name === 'list_drive_spaces')!;
    const out = await t.handler({});
    expect(c.listDriveSpaces).toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual([{ id: 1, name: '팀 스페이스' }]);
  });

  it('list_drive_items → parentId 생략 시 undefined 로 client.listDriveItems 호출', async () => {
    const c = mockClient();
    (c.listDriveItems as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [] });
    const t = buildDriveTools(c).find((x) => x.name === 'list_drive_items')!;
    const out = await t.handler({ spaceId: 3 });
    expect(c.listDriveItems).toHaveBeenCalledWith(3, undefined);
    expect(JSON.parse(out)).toEqual({ folders: [], files: [] });
  });

  it('list_drive_items → parentId 지정 시 그대로 전달', async () => {
    const c = mockClient();
    const t = buildDriveTools(c).find((x) => x.name === 'list_drive_items')!;
    await t.handler({ spaceId: 3, parentId: 8 });
    expect(c.listDriveItems).toHaveBeenCalledWith(3, 8);
  });

  it('search_drive → client.searchDrive(spaceId, q)', async () => {
    const c = mockClient();
    (c.searchDrive as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [{ id: 1 }] });
    const t = buildDriveTools(c).find((x) => x.name === 'search_drive')!;
    const out = await t.handler({ spaceId: 3, q: '보고서' });
    expect(c.searchDrive).toHaveBeenCalledWith(3, '보고서');
    expect(JSON.parse(out)).toEqual({ folders: [], files: [{ id: 1 }] });
  });

  it('search_drive 는 q 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildDriveTools(c).find((x) => x.name === 'search_drive')!;
    await expect(t.handler({ spaceId: 3 })).rejects.toThrow();
    expect(c.searchDrive).not.toHaveBeenCalled();
  });
});
