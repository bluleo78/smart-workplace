// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { clearDriveSaveLocation, readDriveSaveLocation, writeDriveSaveLocation } from './driveSaveLocation'
import { userScopedKey } from './userScopedKey'

const owner = { userId: 1, tenantId: 10 }

describe('driveSaveLocation', () => {
  beforeEach(() => localStorage.clear())

  it('쓰고 읽으면 같은 값이다', () => {
    writeDriveSaveLocation(owner, { spaceId: 3, folderId: 7 })
    expect(readDriveSaveLocation(owner)).toEqual({ spaceId: 3, folderId: 7 })
  })

  it('folderId null(공간 루트)을 보존한다', () => {
    writeDriveSaveLocation(owner, { spaceId: 3, folderId: null })
    expect(readDriveSaveLocation(owner)).toEqual({ spaceId: 3, folderId: null })
  })

  it('다른 사용자는 읽지 못한다', () => {
    writeDriveSaveLocation(owner, { spaceId: 3, folderId: 7 })
    expect(readDriveSaveLocation({ userId: 2, tenantId: 10 })).toBeNull()
  })

  it('깨진 JSON·모양이 틀린 값은 null', () => {
    const key = userScopedKey('drive-save-location', owner)
    localStorage.setItem(key, '{')
    expect(readDriveSaveLocation(owner)).toBeNull()
    localStorage.setItem(key, '{"spaceId":"x"}')
    expect(readDriveSaveLocation(owner)).toBeNull()
    localStorage.setItem(key, '{"spaceId":3,"folderId":"a"}')
    expect(readDriveSaveLocation(owner)).toBeNull()
  })

  it('지우면 읽을 때 null', () => {
    writeDriveSaveLocation(owner, { spaceId: 3, folderId: 7 })
    clearDriveSaveLocation(owner)
    expect(readDriveSaveLocation(owner)).toBeNull()
  })
})
