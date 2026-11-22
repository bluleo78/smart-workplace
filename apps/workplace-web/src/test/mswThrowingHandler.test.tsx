import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from './msw/server'

// 던지는 MSW 핸들러도 XHR 에 응답(500)을 보낸다는 전제를 지킨다(WP-1967 리뷰 후속 반려) — setup.ts 가 unhandledException 에서도
// 끝난 시각을 적어 afterAll 이 그 응답 이벤트 전달을 기다리는 근거다. 이 전제가 바뀌면(msw 업그레이드 등) 그 처리를 다시 본다.
describe('던지는 MSW 핸들러', () => {
  it('XHR 은 500 응답 이벤트(load)를 받는다', async () => {
    server.use(
      http.get('/api/v1/__throwing-handler', () => {
        throw new Error('의도한 실패')
      }),
    )
    const status = await new Promise<number>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', '/api/v1/__throwing-handler')
      xhr.addEventListener('load', () => resolve(xhr.status))
      xhr.addEventListener('error', () => reject(new Error('네트워크 오류로 끝남')))
      xhr.send()
    })
    expect(status).toBe(500)
  })
})
