import { describe, expect, it, vi } from 'vitest'

import type { DriveFileHit } from '../../types/drive'
import { driveFilePath, resolveDriveOpenPath } from './driveOpen'

const hit = (id: number, folderId: number | null) => ({ id, folderId, name: 'b.pdf' }) as DriveFileHit

describe('driveFilePath', () => {
  it('폴더가 있으면 folderId 와 preview 를 함께 싣는다', () => {
    expect(driveFilePath(2, 5, 71)).toBe('/drive/spaces/2?folderId=5&preview=71')
  })
  it('루트 직속이면 preview 만', () => {
    expect(driveFilePath(2, null, 71)).toBe('/drive/spaces/2?preview=71')
  })
})

describe('resolveDriveOpenPath', () => {
  const target = { spaceId: 2, driveFileId: 71, name: 'b.pdf' }
  it('공간 이름 검색에서 같은 id 의 파일을 찾아 그 폴더로 연다', async () => {
    const search = vi.fn().mockResolvedValue({ folders: [], files: [hit(70, 9), hit(71, 5)] })
    await expect(resolveDriveOpenPath(target, search)).resolves.toBe('/drive/spaces/2?folderId=5&preview=71')
    expect(search).toHaveBeenCalledWith(2, 'b.pdf')
  })
  it('검색에 없거나 실패하면 공간 루트로 연다', async () => {
    await expect(resolveDriveOpenPath(target, vi.fn().mockResolvedValue({ folders: [], files: [] }))).resolves.toBe(
      '/drive/spaces/2?preview=71',
    )
    await expect(resolveDriveOpenPath(target, vi.fn().mockRejectedValue(new Error('x')))).resolves.toBe(
      '/drive/spaces/2?preview=71',
    )
  })
})
