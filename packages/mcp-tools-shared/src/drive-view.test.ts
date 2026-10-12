import { describe, expect, it } from 'vitest';
import { toDriveFolderView, toDriveItemsView } from './drive-view.js';

// #840: core fileId 는 제거되고 drive_file.id 는 driveFileId 로만, 나머지 필드는 그대로 전달된다.
describe('toDriveItemsView', () => {
  it('파일 행에서 fileId 를 지우고 id 를 driveFileId 로 옮기며 나머지 필드는 유지한다', () => {
    const out = toDriveItemsView({
      folders: [{ id: 3, name: '폴더' }],
      files: [{ id: 5, fileId: 812, name: '보고서.pdf', available: false }],
    });
    // 폴더는 휴지통 뷰와 같은 이름 folderId 로 가리킨다(WP-353).
    expect(out).toEqual({
      folders: [{ folderId: 3, name: '폴더' }],
      files: [{ driveFileId: 5, name: '보고서.pdf', available: false }],
    });
  });
});

describe('toDriveFolderView', () => {
  it('id 를 folderId 로 바꾸고 나머지 필드는 유지한다(WP-353)', () => {
    expect(toDriveFolderView({ id: 3, parentId: null, name: '폴더' })).toEqual({ folderId: 3, parentId: null, name: '폴더' });
  });
});
