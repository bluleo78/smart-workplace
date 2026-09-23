import { describe, expect, it } from 'vitest';
import { toDriveItemsView } from './drive-view.js';

// #840: core fileId 는 제거되고 drive_file.id 는 driveFileId 로만, 나머지 필드는 그대로 전달된다.
describe('toDriveItemsView', () => {
  it('파일 행에서 fileId 를 지우고 id 를 driveFileId 로 옮기며 나머지 필드는 유지한다', () => {
    const out = toDriveItemsView({
      folders: [{ id: 3, name: '폴더' }],
      files: [{ id: 5, fileId: 812, name: '보고서.pdf', available: false }],
    });
    expect(out).toEqual({
      folders: [{ id: 3, name: '폴더' }],
      files: [{ driveFileId: 5, name: '보고서.pdf', available: false }],
    });
  });
});
