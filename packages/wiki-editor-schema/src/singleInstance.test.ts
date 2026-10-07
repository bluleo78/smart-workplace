// @vitest-environment node
// (DOM 불필요 — happy-dom 의 전역 URL 은 node createRequire 가 받지 않으므로 node 환경에서 돈다.)
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// 스키마 패키지와 웹이 @tiptap/core 를 같은 물리 경로로 해석하는지 — 다르면 인스턴스가 둘이 되어
// 스키마 노드 타입이 어긋난다(WP-283 스파이크에서 실제 발생).
describe('single tiptap instance', () => {
  it('resolves @tiptap/core to the same real path as workplace-web', () => {
    const fromPkg = createRequire(import.meta.url).resolve('@tiptap/core')
    const fromWeb = createRequire(new URL('../../../apps/workplace-web/package.json', import.meta.url)).resolve('@tiptap/core')
    expect(realpathSync(fromPkg)).toBe(realpathSync(fromWeb))
  })
})
