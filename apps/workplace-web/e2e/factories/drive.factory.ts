import type { DriveFile, DriveFolder, DriveSpace } from '../../src/types/drive'

export function createSpace(overrides: Partial<DriveSpace> = {}): DriveSpace {
  return {
    id: 1,
    type: 'TEAM',
    name: '팀 공간',
    ownerId: 1,
    role: 'OWNER',
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
    ...overrides,
  }
}
