import './dom-install'

import * as schemaPkg from '@smart-workplace/wiki-editor-schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { applyKeepLivePlan, markdownToYUpdate, planKeepLive, yDocToMarkdown, yUpdateToRoot } from './markdownCodec'

// 직렬화·파싱 호출 수를 센다 — 메인 스레드 적용 단계가 블록마다 마크다운 왕복을 하지 않는지(WP-289 코드 리뷰 4).
vi.mock('@smart-workplace/wiki-editor-schema', async (importOriginal) => {
  const m = await importOriginal<typeof import('@smart-workplace/wiki-editor-schema')>()
  return { ...m, docToMarkdown: vi.fn(m.docToMarkdown), markdownToDoc: vi.fn(m.markdownToDoc) }
})

const toMd = vi.mocked(schemaPkg.docToMarkdown)
const fromMd = vi.mocked(schemaPkg.markdownToDoc)

describe('keepLive apply on the main thread', () => {
  beforeEach(() => {
    toMd.mockClear()
    fromMd.mockClear()
  })

  it('does no markdown serialization or parsing for a 5000-block note', () => {
    const blocks = Array.from({ length: 5000 }, (_, i) => `문단 ${i}`)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate(blocks.join('\n\n')))
    const merged = [...blocks.slice(0, 2500), '문단 2500 AI', ...blocks.slice(2501)].join('\n\n')
    // 워커 쪽 — 블록 직렬화·LCS 는 여기서(메인 스레드 밖) 한다.
    const plan = structuredClone(planKeepLive(yUpdateToRoot(Y.encodeStateAsUpdate(doc)), merged))
    expect(plan.blocks.filter((b) => typeof b !== 'number')).toHaveLength(1)
    toMd.mockClear()
    fromMd.mockClear()
    const started = performance.now()
    expect(applyKeepLivePlan(doc, plan, 'ai')).toBe(2500)
    const ms = performance.now() - started
    expect(toMd).not.toHaveBeenCalled()
    expect(fromMd).not.toHaveBeenCalled()
    console.info(`[main-thread keepLive apply] 5000 blocks: ${ms.toFixed(0)}ms`)
    expect(yDocToMarkdown(doc)).toBe(merged)
  })

  it('refuses a plan made for a different document state', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate('가\n\n나'))
    const plan = planKeepLive(yUpdateToRoot(Y.encodeStateAsUpdate(doc)), '가 AI\n\n나')
    Y.applyUpdate(doc, markdownToYUpdate('다'))
    expect(() => applyKeepLivePlan(doc, plan, 'ai')).toThrow(/keepLive plan/)
  })
})
