// updateIssueTypeOf 요청 본문(WP-2098) — convertSubtasksToTypeId 는 줄 때만 실린다.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { client } from './client'
import { updateIssueTypeOf } from './issueTypes'

describe('updateIssueTypeOf — convertSubtasksToTypeId', () => {
  afterEach(() => vi.restoreAllMocks())

  it('주면 본문에 싣는다', async () => {
    const spy = vi.spyOn(client, 'patch').mockResolvedValue({ data: {} })
    await updateIssueTypeOf('P', 2, 6, undefined, { convertSubtasksToTypeId: 1 })
    expect(spy).toHaveBeenCalledWith('/projects/P/issues/2/type', { typeId: 6, convertSubtasksToTypeId: 1 })
  })

  it('생략하면 키가 없다', async () => {
    const spy = vi.spyOn(client, 'patch').mockResolvedValue({ data: {} })
    await updateIssueTypeOf('P', 2, 6)
    expect(spy.mock.calls[0][1]).toEqual({ typeId: 6 })
    expect('convertSubtasksToTypeId' in (spy.mock.calls[0][1] as object)).toBe(false)
  })
})
