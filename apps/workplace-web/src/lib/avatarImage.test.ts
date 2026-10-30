// 아바타 이미지 크기 고르기·파일 검사(WP-1222) — 표시 px 의 2배 이상인 가장 작은 벌(64·128·256)과 업로드 전 한국어 안내.
import { describe, expect, it } from 'vitest'

import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, AVATAR_TYPE_MSG, avatarDimensionError, avatarFileError, avatarSizeFor, avatarSrc } from './avatarImage'

describe('avatarSizeFor — 2배 규칙', () => {
  it.each([
    [20, 64],
    [24, 64],
    [32, 64],
    [33, 128],
    [40, 128],
    [64, 128],
    [65, 256],
    [80, 256],
    [400, 256],
  ])('%ipx 표시는 %ipx 이미지', (px, size) => {
    expect(avatarSizeFor(px)).toBe(size)
  })
})

describe('avatarSrc', () => {
  it('주소 뒤에 크기를 붙인다', () => {
    expect(avatarSrc('/api/v1/avatars/7/abcd', 24)).toBe('/api/v1/avatars/7/abcd/64')
    expect(avatarSrc('/api/v1/avatars/7/abcd', 80)).toBe('/api/v1/avatars/7/abcd/256')
  })
  it('끝 슬래시가 있어도 겹치지 않는다', () => {
    expect(avatarSrc('/api/v1/avatars/7/abcd/', 36)).toBe('/api/v1/avatars/7/abcd/128')
  })
  it('주소가 없으면 null(이니셜로 그린다)', () => {
    expect(avatarSrc(null, 24)).toBeNull()
    expect(avatarSrc(undefined, 24)).toBeNull()
    expect(avatarSrc('', 24)).toBeNull()
  })
})

describe('avatarFileError — 고르기 전 검사', () => {
  it('고르기 창 accept 는 본문 이미지와 같은 4종', () => {
    expect(AVATAR_ACCEPT.split(',').sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
  })
  it('형식 안내는 본문 이미지 안내와 같은 표기', () => {
    expect(AVATAR_TYPE_MSG).toBe('PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다.')
  })
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])('%s 5MB 이하면 통과', (type) => {
    expect(avatarFileError({ type, size: AVATAR_MAX_BYTES })).toBeNull()
  })
  it('다른 형식은 형식 안내', () => {
    expect(avatarFileError({ type: 'image/svg+xml', size: 10 })).toBe(AVATAR_TYPE_MSG)
    expect(avatarFileError({ type: 'application/pdf', size: 10 })).toBe(AVATAR_TYPE_MSG)
    expect(avatarFileError({ type: '', size: 10 })).toBe(AVATAR_TYPE_MSG)
  })
  it('5MB 를 넘으면 크기 안내', () => {
    expect(avatarFileError({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 })).toBe('5MB 이하의 이미지만 올릴 수 있습니다.')
  })
})

describe('avatarDimensionError — 읽은 뒤 가로·세로', () => {
  it('짧은 변이 128px 이상, 긴 변이 4000px 이하면 통과', () => {
    expect(avatarDimensionError(128, 128)).toBeNull()
    expect(avatarDimensionError(4000, 128)).toBeNull()
  })
  it('짧은 변이 128px 미만이면 안내', () => {
    expect(avatarDimensionError(127, 900)).toBe('가로·세로 128px 이상인 이미지를 골라 주세요.')
  })
  it('긴 변이 4000px 을 넘으면 안내', () => {
    expect(avatarDimensionError(4001, 300)).toBe('가로·세로 4000px 이하인 이미지를 골라 주세요.')
  })
})
