// 모델 프로브 실패 문구 — 응답이 없는 실패(네트워크·Axios 밖 예외)는 네트워크 안내를 덧붙이지 않고 안내만 보인다(WP-1884).
import { AxiosError } from 'axios'
import { expect, test } from 'vitest'

import { probeModelsErrorMessage } from './probeModelsError'

const FALLBACK = '모델 목록을 불러오지 못했습니다. 모델 id를 직접 입력하세요.'

test('응답 없는 네트워크 오류는 안내만 — 마침표가 겹친 네트워크 안내를 붙이지 않는다', () => {
  const offline = new AxiosError('Network Error', 'ERR_NETWORK')
  expect(probeModelsErrorMessage(offline)).toBe(FALLBACK)
})

test('Axios 가 아닌 예외도 안내를 보인다', () => {
  expect(probeModelsErrorMessage(new Error('boom'))).toBe(FALLBACK)
})
