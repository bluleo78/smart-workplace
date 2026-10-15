// 본문 평문화(접근 이름·복사용) 단위 테스트(WP-412). 복사 액션 → 클립보드·토스트 배선은 mobile/uiux-u5 E2E 가 지킨다.
import { describe, expect, it } from 'vitest'

import { messagePlainText } from './parseMessageSegments'

describe('messagePlainText', () => {
  it('<@id> 멘션 토큰을 @이름 으로 바꾼다', () => {
    expect(messagePlainText('<@20> 확인 부탁해요', [{ id: 20, name: '동료', kind: 'HUMAN' }])).toBe('@동료 확인 부탁해요')
  })
  it('멘션 정보가 없는 토큰은 @알 수 없음, 토큰이 없으면 본문 그대로', () => {
    expect(messagePlainText('a <@9> b', [])).toBe('a @알 수 없음 b')
    expect(messagePlainText('그냥 텍스트', [])).toBe('그냥 텍스트')
  })
})
