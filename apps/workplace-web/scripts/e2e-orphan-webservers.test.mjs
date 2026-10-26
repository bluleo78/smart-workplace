// 고아 webServer 판정(WP-972) — ps 출력 문자열만으로 판정을 검증한다.
import { describe, expect, it } from 'vitest'

import { findOrphanGroups, findStalePreviewDirs } from './e2e-orphan-webservers.mjs'

const RUNNER = '100 50 100 node /repo/node_modules/.bin/../playwright/cli.js test --workers=3'
const ps = (...lines) => lines.join('\n')

describe('findOrphanGroups', () => {
  it('부모 러너가 살아 있는 webServer 그룹은 고르지 않는다', () => {
    const out = ps(
      RUNNER,
      '200 100 200 /bin/sh -c pnpm --filter @smart-workplace/workplace-collab start:test',
      '300 100 300 /bin/sh -c pnpm exec vite build --outDir /tmp/smart-workplace-e2e-dist-24627 --emptyOutDir --logLevel warn && pnpm exec vite preview --outDir /tmp/smart-workplace-e2e-dist-24627 --port 24627 --strictPort',
    )
    expect(findOrphanGroups(out)).toEqual([])
  })

  it('부모가 init 으로 넘어간 동기화 서버·preview 그룹은 고른다', () => {
    const out = ps(
      '200 1 200 /bin/sh -c pnpm --filter @smart-workplace/workplace-collab start:test',
      '201 200 200 node /usr/bin/pnpm --filter @smart-workplace/workplace-collab start:test',
      '300 1 300 /bin/sh -c pnpm exec vite build --outDir /tmp/smart-workplace-e2e-dist-24627 --emptyOutDir --logLevel warn && pnpm exec vite preview --outDir /tmp/smart-workplace-e2e-dist-24627 --port 24627 --strictPort',
    )
    expect(findOrphanGroups(out)).toEqual([200, 300])
  })

  it('subreaper 등 러너가 아닌 부모 밑에 남은 그룹도 고른다', () => {
    const out = ps('90 1 90 /usr/lib/systemd/systemd --user', '200 90 200 /bin/sh -c pnpm --filter @smart-workplace/workplace-collab start:test')
    expect(findOrphanGroups(out)).toEqual([200])
  })

  it('그룹 우두머리가 아닌 자식이나 다른 명령(6173 dev 서버 등)은 고르지 않는다', () => {
    const out = ps(
      '201 1 200 node /usr/bin/pnpm --filter @smart-workplace/workplace-collab start:test',
      '400 1 400 /bin/sh -c pnpm dev --port 6173',
      '500 1 500 node vite preview --outDir dist',
    )
    expect(findOrphanGroups(out)).toEqual([])
  })

  it('E2E 포트대(20000번대) dev 서버만 고르고 6173 dev 서버는 두지 않는다', () => {
    const out = ps('400 1 400 /bin/sh -c pnpm dev --port 24627 --strictPort', '410 1 410 /bin/sh -c pnpm dev --port 6173 --strictPort')
    expect(findOrphanGroups(out)).toEqual([400])
  })

  it('명령줄 일부에 같은 문자열을 담은 다른 프로세스(grep·셸 스크립트)는 고르지 않는다', () => {
    const out = ps(
      "600 1 600 /bin/bash -c ps -eo args | grep -E 'workplace-collab start:test|pnpm dev --port 2'",
      '610 1 610 /bin/sh -c pnpm --filter @smart-workplace/workplace-collab start:test && echo done',
    )
    expect(findOrphanGroups(out)).toEqual([])
  })

  it('러너 프로세스 자체는 고르지 않는다', () => {
    const out = ps(RUNNER)
    expect(findOrphanGroups(out)).toEqual([])
  })
})

describe('findStalePreviewDirs', () => {
  const age = { 'smart-workplace-e2e-dist-1': 3_600_000, 'smart-workplace-e2e-dist-2': 3_600_000, 'smart-workplace-e2e-dist-3': 60_000, other: 9e9 }
  it('쓰는 프로세스가 없고 오래된 preview 폴더만 고른다', () => {
    const out = ps('300 100 300 /bin/sh -c pnpm exec vite preview --outDir /tmp/smart-workplace-e2e-dist-2 --port 2')
    expect(findStalePreviewDirs(Object.keys(age), out, (n) => age[n], 30 * 60_000)).toEqual(['smart-workplace-e2e-dist-1'])
  })
})
