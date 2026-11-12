import { describe, expect, it } from 'vitest'

import { isVideoUpload, uploadLimitFor } from './uploadLimit'

const MB = 1024 * 1024
const GB = 1024 * MB

describe('isVideoUpload — 서버 MimeNormalizer·FileUploadService.categoryOf 와 같은 판정(WP-1519)', () => {
  it('구체적인 video/* 형식은 동영상(하위 형식·대소문자·매개변수 무관)', () => {
    expect(isVideoUpload({ name: 'a.bin', type: 'video/mp4' })).toBe(true)
    expect(isVideoUpload({ name: 'a', type: 'video/x-matroska' })).toBe(true)
    expect(isVideoUpload({ name: 'a', type: 'Video/MP4; codecs=avc1' })).toBe(true)
  })

  it('형식이 비었거나 octet-stream 이면 확장자로 정한다', () => {
    expect(isVideoUpload({ name: 'clip.mp4', type: '' })).toBe(true)
    expect(isVideoUpload({ name: 'CLIP.MOV', type: 'application/octet-stream' })).toBe(true)
    expect(isVideoUpload({ name: 'a.mkv', type: '' })).toBe(true)
    expect(isVideoUpload({ name: 'a.zip', type: '' })).toBe(false)
    expect(isVideoUpload({ name: '확장자없음', type: '' })).toBe(false)
  })

  it('구체적인 다른 형식은 확장자가 동영상이어도 따르지 않는다(서버도 브라우저 형식을 믿는다)', () => {
    expect(isVideoUpload({ name: 'a.mp4', type: 'application/zip' })).toBe(false)
    expect(isVideoUpload({ name: 'a.pdf', type: 'application/pdf' })).toBe(false)
  })
})

describe('uploadLimitFor — 업로드 전 사전 검사 상한', () => {
  it('동영상은 1GB — 정확히 1GB 는 통과, 1바이트라도 넘으면 초과', () => {
    const limit = uploadLimitFor({ name: 'movie.mp4', type: 'video/mp4' })
    expect(limit).toEqual({ maxBytes: GB, label: '1GB' })
    expect(900 * MB <= limit.maxBytes).toBe(true)
    expect(GB <= limit.maxBytes).toBe(true)
    expect(GB + 1 <= limit.maxBytes).toBe(false)
  })

  it('동영상이 아니면 지금과 같은 100MB', () => {
    expect(uploadLimitFor({ name: 'big.pdf', type: 'application/pdf' })).toEqual({ maxBytes: 100 * MB, label: '100MB' })
    expect(uploadLimitFor({ name: 'big.bin', type: '' })).toEqual({ maxBytes: 100 * MB, label: '100MB' })
  })
})
