import { describe, expect, it } from 'vitest'

import { channelEmptyAction, dmEmptyAction } from './chatEmptyAction'

describe('channelEmptyAction', () => {
  it('OWNER·ADMIN 은 멤버 초대', () => {
    expect(channelEmptyAction({ archived: false, role: 'OWNER' })).toBe('invite')
    expect(channelEmptyAction({ archived: false, role: 'ADMIN' })).toBe('invite')
  })
  it('MEMBER 는 첫 메시지', () => expect(channelEmptyAction({ archived: false, role: 'MEMBER' })).toBe('compose'))
  it('보관 채널은 없음', () => expect(channelEmptyAction({ archived: true, role: 'OWNER' })).toBeNull())
  it('비멤버 열람자는 없음', () => expect(channelEmptyAction({ archived: false, role: null })).toBeNull())
})
describe('dmEmptyAction', () => {
  it('보낼 수 있으면 첫 메시지', () => expect(dmEmptyAction({ blocked: false })).toBe('compose'))
  it('받는 사람이 모두 정지면 없음', () => expect(dmEmptyAction({ blocked: true })).toBeNull())
})
