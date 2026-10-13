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

  // 단언은 호출 수(0)라 크기와 무관하다 — 블록마다 왕복하면 블록 수만큼 불리므로 500 블록으로도 같은 퇴화를 잡는다.
  // (예전 5000 블록은 준비 단계 — 문서 만들기·워커 쪽 계획 — 만으로 병렬 부하에서 테스트 시간 제한을 넘겼다.)
  it('does no markdown serialization or parsing for a 500-block note', () => {
    const blocks = Array.from({ length: 500 }, (_, i) => `문단 ${i}`)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate(blocks.join('\n\n')))
    const merged = [...blocks.slice(0, 250), '문단 250 AI', ...blocks.slice(251)].join('\n\n')
    // 워커 쪽 — 블록 직렬화·LCS 는 여기서(메인 스레드 밖) 한다.
    const plan = structuredClone(planKeepLive(yUpdateToRoot(Y.encodeStateAsUpdate(doc)), merged))
    expect(plan.blocks.filter((b) => typeof b !== 'number')).toHaveLength(1)
    toMd.mockClear()
    fromMd.mockClear()
    const started = performance.now()
    expect(applyKeepLivePlan(doc, plan, 'ai')).toBe(250)
    const ms = performance.now() - started
    expect(toMd).not.toHaveBeenCalled()
    expect(fromMd).not.toHaveBeenCalled()
    console.info(`[main-thread keepLive apply] 500 blocks: ${ms.toFixed(0)}ms`)
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
