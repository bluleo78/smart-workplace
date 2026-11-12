// 재생 주소로 바로 재생할 형식 판정(WP-1532) — API 형식 목록과 같아야 웹이 409 를 받지 않는다.
import { describe, expect, it } from 'vitest'

import { isStreamableMime } from './drivePlayback'

describe('isStreamableMime', () => {
  it('구체적인 영상·오디오 컨테이너는 바로 재생한다(파라미터·대소문자·별칭 무시)', () => {
    expect(isStreamableMime('video/mp4')).toBe(true)
    expect(isStreamableMime('Video/WebM; codecs="vp9"')).toBe(true)
    expect(isStreamableMime('video/quicktime')).toBe(true)
    expect(isStreamableMime('audio/mpeg')).toBe(true)
    expect(isStreamableMime('audio/mp3')).toBe(true)
    expect(isStreamableMime('audio/x-wav')).toBe(true)
  })

  it('재생 목록·asf·avi 와 미디어가 아닌 형식은 blob 경로로 둔다', () => {
    expect(isStreamableMime('application/vnd.apple.mpegurl')).toBe(false)
    expect(isStreamableMime('audio/x-mpegurl')).toBe(false)
    expect(isStreamableMime('video/x-ms-asf')).toBe(false)
    expect(isStreamableMime('video/x-msvideo')).toBe(false)
    expect(isStreamableMime('text/html')).toBe(false)
    expect(isStreamableMime(null)).toBe(false)
  })
})
