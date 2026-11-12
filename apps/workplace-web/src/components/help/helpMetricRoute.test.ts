// helpMetricRoute — 측정으로 보내는 주소에서 식별자·토큰을 걷어내는 순수 함수 판정(WP-1512).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { helpMetricRoute, PARAM_PREFIXES } from './helpMetricRoute'

describe('helpMetricRoute', () => {
  it('keeps static paths', () => {
    expect(helpMetricRoute('/')).toBe('/')
    expect(helpMetricRoute('/settings/audit-logs')).toBe('/settings/audit-logs')
  })
  it('replaces numeric, issue-key, uuid and token-like segments', () => {
    expect(helpMetricRoute('/issues/WP-1512')).toBe('/issues/:id')
    expect(helpMetricRoute('/drive/files/3f2b8c1e-1d2a-4b5c-9d8e-0123456789ab')).toBe('/drive/files/:id')
    expect(helpMetricRoute('/mail/7')).toBe('/mail/:id')
  })
  // 한 화면은 한 줄 — 프로젝트 키처럼 숫자가 아닌 라우트 파라미터도 이름으로 바꾼다
  it('replaces project keys so one screen is one route', () => {
    expect(helpMetricRoute('/projects/WP/issues/12')).toBe('/projects/:key/issues/:id')
    expect(helpMetricRoute('/projects/TEAM2/issues/7')).toBe(helpMetricRoute('/projects/WP/issues/12'))
    expect(helpMetricRoute('/projects/TEAM2/settings')).toBe('/projects/:key/settings')
    expect(helpMetricRoute('/projects/WP')).toBe('/projects/:key')
    expect(helpMetricRoute('/projects')).toBe('/projects')
  })
  it('replaces share-link tokens even when short', () => {
    expect(helpMetricRoute('/s/AbCdEf1234567890XyZ12')).toBe('/s/:token')
    expect(helpMetricRoute('/s/abc')).toBe('/s/:token')
    expect(helpMetricRoute('/wiki/share/abc/pages/12')).toBe('/wiki/share/:token/pages/:id')
  })
  // 고정 경로이거나 정해진 탭 값이라 남는 것들
  it('leaves static and tab segments unchanged', () => {
    expect(helpMetricRoute('/me/tasks/today')).toBe('/me/tasks/today')
    expect(helpMetricRoute('/settings/agents/locations')).toBe('/settings/agents/locations')
    expect(helpMetricRoute('/settings/help-metrics')).toBe('/settings/help-metrics')
    expect(helpMetricRoute('/wiki/internationalizationconfiguration')).toBe('/wiki/internationalizationconfiguration')
  })
  it('caps at 200 chars', () => {
    expect(helpMetricRoute('/' + 'a'.repeat(300)).length).toBe(200)
  })
})

// 드리프트 가드 — App.tsx 에 숫자 id 가 아닌 `:param`(프로젝트 키·토큰 등) 라우트가 새로 생기면 PARAM_PREFIXES 에도 더하도록 실패시킨다.
describe('helpMetricRoute route drift guard', () => {
  /** 숫자·UUID id 자리로 보는 파라미터 이름(isIdLike 가 걷는다) — `:id`·`:xxxId`·`:number`. `:tab` 은 정해진 값이라 그대로 둔다. */
  const ID_PARAM = /^(id|number|tab|\w+Id)$/

  it('covers every non-id route param of App.tsx with PARAM_PREFIXES', () => {
    const source = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
    const paths = [...source.matchAll(/path="([^"]*:[^"]*)"/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThan(0)
    const uncovered: string[] = []
    for (const path of paths) {
      const segs = path.split('/').filter(Boolean)
      segs.forEach((seg, i) => {
        if (!seg.startsWith(':') || ID_PARAM.test(seg.slice(1))) return
        // 이 파라미터 앞의 고정 조각이 PARAM_PREFIXES 의 같은 이름 규칙과 같아야 한다.
        const prefix = segs.slice(0, i)
        const covered = PARAM_PREFIXES.some((r) => r.param === seg && r.prefix.join('/') === prefix.join('/'))
        if (!covered) uncovered.push(path)
      })
    }
    // 실패하면: helpMetricRoute.ts 의 PARAM_PREFIXES 에 { prefix: [앞 고정 조각], param: ':이름' } 을 더한다(id 꼴이면 ID_PARAM 에 이름을 더한다).
    expect(uncovered).toEqual([])
  })
})
