// scripts/image-typecheck.mjs 의 .dockerignore·Dockerfile COPY 해석 단위 테스트 (WP-1026) — `node --test scripts/image-typecheck.test.mjs`
// 이 해석이 Docker 와 어긋나면 검사 복사본에 이미지에 없는 파일이 남아 깨지는 빌드를 놓친다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildStageCopySources, isExcluded, parseDockerignore } from './image-typecheck.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('`**/` 패턴은 어느 깊이에서나(루트 포함) 맞는다', () => {
  const rules = parseDockerignore('**/*.test.ts\n**/src/test/\n')
  assert.equal(isExcluded('a.test.ts', rules), true)
  assert.equal(isExcluded('apps/workplace-web/src/lib/x.test.ts', rules), true)
  assert.equal(isExcluded('apps/workplace-web/src/test/msw/versionHandlers.ts', rules), true)
  assert.equal(isExcluded('apps/workplace-web/src/pages/projects/remainingPages.handlers.ts', rules), false)
  // 이름이 test 로 끝나기만 하는 폴더는 빠지지 않는다
  assert.equal(isExcluded('apps/workplace-web/src/latest/x.ts', rules), false)
})

test('`**` 없는 패턴은 루트 기준이고, 폴더가 빠지면 그 아래 전부 빠진다', () => {
  const rules = parseDockerignore('# 주석\n\n*.log\n.claude/\napps/workplace-collab/out/\n')
  assert.equal(isExcluded('debug.log', rules), true)
  assert.equal(isExcluded('apps/x/debug.log', rules), false)
  assert.equal(isExcluded('.claude/worktrees/WP-1/a.ts', rules), true)
  assert.equal(isExcluded('apps/workplace-collab/out/page.json', rules), true)
  assert.equal(isExcluded('apps/workplace-collab/src/out.ts', rules), false)
})

test('`!` 예외는 뒤에 올 때 앞의 제외를 되돌린다', () => {
  const rules = parseDockerignore('**/*.spec.ts\n!apps/keep/a.spec.ts\n')
  assert.equal(isExcluded('apps/keep/a.spec.ts', rules), false)
  assert.equal(isExcluded('apps/other/a.spec.ts', rules), true)
})

test('글자 묶음 [..]·이스케이프는 Docker(Go filepath.Match)처럼 읽는다', () => {
  const rules = parseDockerignore('**/[Tt]est/\n**/*.[jt]est.ts\n**/a\\*b\n')
  assert.equal(isExcluded('apps/x/Test/a.ts', rules), true)
  assert.equal(isExcluded('apps/x/test/a.ts', rules), true)
  assert.equal(isExcluded('apps/x/best/a.ts', rules), false)
  assert.equal(isExcluded('apps/x/a.jest.ts', rules), true)
  assert.equal(isExcluded('a*b', rules), true)
  assert.equal(isExcluded('axb', rules), false)
})

test('Dockerfile 빌드 단계의 문맥 COPY 원본만 고른다(--from·다음 단계는 뺀다)', () => {
  const dockerfile = [
    'FROM node:22 AS build',
    'WORKDIR /app',
    'COPY pnpm-lock.yaml package.json ./',
    'COPY packages/shared/src/a.ts ./packages/shared/src/',
    'COPY apps/web/ ./apps/web/',
    'FROM nginx',
    'COPY --from=build /app/apps/web/dist /usr/share/nginx/html',
    'COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf',
  ].join('\n')
  const dirs = new Set(['apps/web'])
  assert.deepEqual(buildStageCopySources(dockerfile, (s) => dirs.has(s)), [
    'pnpm-lock.yaml',
    'package.json',
    'packages/shared/src/a.ts',
    'apps/web',
  ])
})

test('원본과 다른 자리로 COPY 하면 재현할 수 없다고 알린다', () => {
  assert.throws(() => buildStageCopySources('FROM node\nCOPY apps/web/ ./web/\n', () => true), /다른 자리/)
})

test('저장소 앱 Dockerfile 은 모두 원본과 같은 자리로 COPY 하고 앱 폴더를 넣는다', () => {
  const isDir = (s) => fs.existsSync(path.join(root, s)) && fs.statSync(path.join(root, s)).isDirectory()
  for (const app of ['workplace-web', 'workplace-admin', 'workplace-collab']) {
    const sources = buildStageCopySources(fs.readFileSync(path.join(root, 'apps', app, 'Dockerfile'), 'utf8'), isDir)
    assert.ok(sources.includes(`apps/${app}`), app)
  }
})

test('저장소 .dockerignore 는 테스트 파일·src/test/ 를 빼고 앱 소스는 남긴다', () => {
  const rules = parseDockerignore(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8'))
  assert.equal(isExcluded('apps/workplace-web/src/test/msw/server.ts', rules), true)
  assert.equal(isExcluded('apps/workplace-web/src/pages/HomePage.test.tsx', rules), true)
  assert.equal(isExcluded('apps/workplace-web/e2e/home.spec.ts', rules), true)
  assert.equal(isExcluded('apps/workplace-web/src/App.tsx', rules), false)
  assert.equal(isExcluded('packages/wiki-editor-schema/src/index.ts', rules), false)
})
