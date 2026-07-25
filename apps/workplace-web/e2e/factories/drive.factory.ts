import type { DriveFile, DriveFileVersion, DriveFolder, DriveSpace, DriveTrashList } from '../../src/types/drive'

export function createSpace(overrides: Partial<DriveSpace> = {}): DriveSpace {
  return {
    id: 1,
    type: 'TEAM',
    name: '팀 공간',
    ownerId: 1,
    role: 'OWNER',
    // #76: archived 필드 추가 — DriveSpace 타입과 동기화.
    archived: false,
    createdAt: new Date('2026-06-01').toISOString(),
    ...overrides,
  }
}

export function personalSpace(overrides: Partial<DriveSpace> = {}): DriveSpace {
  return createSpace({ id: 99, type: 'PERSONAL', name: '내 드라이브', ...overrides })
}

export function createFolder(overrides: Partial<DriveFolder> = {}): DriveFolder {
  return {
    id: 10,
    parentId: null,
    name: '문서',
    createdAt: new Date('2026-06-01').toISOString(),
    ...overrides,
  }
}

export function createFile(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 20,
    folderId: null,
    fileId: 500,
    name: 'memo.txt',
    mimeType: 'text/plain',
    sizeBytes: 5,
    category: 'TEXT',
    createdAt: new Date('2026-06-01').toISOString(),
    // #79: 기본 버전 수 1
    versionCount: 1,
    // #739: 기본은 원본 blob 존재(정상 파일). 유실 시나리오는 overrides로 false 지정.
    available: true,
    ...overrides,
  }
}

// #79: 버전 팩토리 — DriveFileVersion 모킹 데이터 생성.
export function createVersion(overrides: Partial<DriveFileVersion> = {}): DriveFileVersion {
  return {
    versionNo: 1,
    fileId: 10,
    sizeBytes: 100,
    uploadedBy: 1,
    uploadedByName: '홍길동',
    createdAt: '2026-06-21T00:00:00Z',
    comment: null,
    current: true,
    ...overrides,
  }
}

export function makeTrashList(overrides: Partial<DriveTrashList> = {}): DriveTrashList {
  return {
    items: [
      {
        type: 'FILE',
        id: 901,
        name: 'memo.txt',
        originalPath: '',
        trashedAt: '2026-06-04T00:00:00Z',
        autoPurgeAt: '2026-07-04T00:00:00Z',
        sizeBytes: 5,
      },
    ],
    ...overrides,
  }
}
