import { describe, expect, it } from 'vitest'

import { actionSlots, resolveSaveMethod, resolveShareState } from './viewerActions'

describe('resolveShareState', () => {
  const ok = { supported: true, fetches: true, blobReady: true, canShareFile: true }
  it('blob 이 있고 공유 가능하면 ready', () => {
    expect(resolveShareState(ok)).toBe('ready')
  })
  it('받는 중이면 loading', () => {
    expect(resolveShareState({ ...ok, blobReady: false, canShareFile: false })).toBe('loading')
  })
  it('blob 을 받지 않는 항목(미지원 형식·10MB 동의 대기·오류)은 영원히 받는 중이 아니라 unavailable', () => {
    expect(resolveShareState({ ...ok, fetches: false, blobReady: false })).toBe('unavailable')
  })
  it('브라우저 미지원·형식 공유 불가(canShare 거짓)는 unavailable', () => {
    expect(resolveShareState({ ...ok, supported: false })).toBe('unavailable')
    expect(resolveShareState({ ...ok, canShareFile: false })).toBe('unavailable')
  })
})

describe('actionSlots', () => {
  const base = { unavailable: false, share: 'ready' as const, importable: 'ready' as const, summary: true }
  it('항상 4칸, 순서 고정', () => {
    expect(actionSlots(base).map((s) => s.id)).toEqual(['save', 'share', 'drive', 'summary'])
    expect(actionSlots({ ...base, importable: 'none', summary: false }).map((s) => s.id)).toEqual(['save', 'share', 'drive', 'summary'])
  })
  it('없는 기능은 빈칸(위치 유지)', () => {
    const s = actionSlots({ ...base, importable: 'none', summary: false })
    expect(s.map((x) => x.state)).toEqual(['enabled', 'enabled', 'empty', 'empty'])
  })
  it('공유 준비 전·불가는 비활성, 가져오기 준비 전은 비활성', () => {
    expect(actionSlots({ ...base, share: 'loading' })[1].state).toBe('disabled')
    expect(actionSlots({ ...base, share: 'unavailable' })[1].state).toBe('disabled')
    expect(actionSlots({ ...base, importable: 'disabled' })[2].state).toBe('disabled')
  })
  it('링크 원본 삭제면 저장·공유도 빈칸', () => {
    expect(actionSlots({ ...base, unavailable: true }).map((x) => x.state)).toEqual(['empty', 'empty', 'enabled', 'enabled'])
  })
})

describe('resolveSaveMethod', () => {
  it('iOS 홈 화면 앱 + blob + 공유 가능이면 공유 시트로 저장', () => {
    expect(resolveSaveMethod({ iosStandalone: true, blobReady: true, canShareFile: true })).toBe('share')
  })
  it('그 외는 기존 다운로드', () => {
    expect(resolveSaveMethod({ iosStandalone: false, blobReady: true, canShareFile: true })).toBe('download')
    expect(resolveSaveMethod({ iosStandalone: true, blobReady: false, canShareFile: false })).toBe('download')
    expect(resolveSaveMethod({ iosStandalone: true, blobReady: true, canShareFile: false })).toBe('download')
  })
})
