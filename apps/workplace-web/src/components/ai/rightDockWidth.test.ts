// 오른쪽 도킹 칸 폭 변수(WP-1505) — 칸(AI 옆 패널 + 도움말 패널)을 피해야 하는 자리는 합친 변수 --right-dock-width(index.css :root) 하나를 읽는다.
// 메일 작성 크게 보기·개인 작업 창·상단 가운데 칩처럼 useAiPanelAwareDialog 상수를 쓰지 않는 소비처도 있어 소스 전체를 훑는다 —
// AI 폭·도움말 폭을 var() 로 따로 읽는 자리가 하나라도 있으면(칸의 한쪽만 빼는 실수) 실패한다.
// 변수를 쓰는 쪽(setProperty)·합을 정의하는 index.css 는 var() 로 읽지 않거나 .ts/.tsx 가 아니라 걸리지 않는다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** dir 아래 소스(테스트 제외) 경로를 모두 모은다. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('오른쪽 도킹 칸 폭 변수', () => {
  it('소스 어디서도 AI·도움말 폭을 따로 읽지 않는다 — 칸을 피하는 자리는 --right-dock-width 를 쓴다', () => {
    const src = fileURLToPath(new URL('../..', import.meta.url))
    const offenders = sourceFiles(src.replace(/\/$/, '')).filter((path) => /var\(--(ai|help)-side-width/.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('index.css :root 가 두 폭의 합으로 --right-dock-width 를 정의한다', () => {
    const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')
    expect(css).toMatch(/--right-dock-width:\s*calc\(var\(--ai-side-width,\s*0px\)\s*\+\s*var\(--help-side-width,\s*0px\)\)/)
  })
})
