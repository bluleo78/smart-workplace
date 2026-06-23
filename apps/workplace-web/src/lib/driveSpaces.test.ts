import { describe, expect, it } from 'vitest'

import type { DriveSpace } from '../types/drive'
import { partitionSpaces } from './driveSpaces'

function space(id: number, type: DriveSpace['type'], name: string): DriveSpace {
  return { id, type, name, ownerId: 1, role: 'EDITOR', archived: false, createdAt: '2026-06-01T00:00:00Z' }
}

describe('partitionSpaces', () => {
  it('CHANNEL 은 channel, 나머지는 primary 로 분리하고 순서를 보존한다', () => {
    const spaces = [
      space(1, 'PERSONAL', '내 드라이브'),
      space(2, 'CHANNEL', '마케팅'),
      space(3, 'TEAM', '디자인팀'),
      space(4, 'CHANNEL', '개발'),
    ]
    const { primary, channel } = partitionSpaces(spaces)
    expect(primary.map((s) => s.id)).toEqual([1, 3])
    expect(channel.map((s) => s.id)).toEqual([2, 4])
  })

  it('빈 입력은 빈 배열 둘을 반환한다', () => {
    expect(partitionSpaces([])).toEqual({ primary: [], channel: [] })
  })
})
