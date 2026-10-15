// index.html viewport 메타 — 노치·홈 인디케이터 안전영역의 전제 조건.
// iOS 는 viewport-fit=cover 가 없으면 env(safe-area-inset-*) 를 0 으로 계산해 하단 탭바의 pb-[env(safe-area-inset-bottom)] 가
// 무력화되고 홈 인디케이터가 탭 이름을 가린다. 브라우저(Chromium)는 안전영역을 에뮬레이트하지 못하므로 E2E 대신 정적 메타만 고정한다(WP-408).
import { describe, expect, it } from 'vitest'

import html from '../index.html?raw'

describe('index.html viewport 메타', () => {
  it('viewport-fit=cover 를 담는다 — 하단 탭바가 홈 인디케이터 영역을 비울 수 있다', () => {
    const content = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1]
    expect(content).toBeDefined()
    expect(content).toContain('viewport-fit=cover')
  })
})
