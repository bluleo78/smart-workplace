#!/usr/bin/env node
// 이미지 빌드와 같은 입력으로 앱 타입 검사 (WP-1026) — `node scripts/image-typecheck.mjs [앱 폴더 이름…]`
//
// 왜: 이미지 빌드는 Dockerfile 이 COPY 한 파일 중 루트 .dockerignore 가 테스트 파일·src/test/ 를 뺀 상태로 tsc 를 돌린다.
//   테스트 아닌 파일이 src/test/ 를 import 하면 로컬·CI(파일이 다 있음)는 통과하고 이미지 빌드만 깨진다(v0.9.24, WP-1007).
// 어떻게: 앱마다 apps/<앱>/Dockerfile 의 빌드 단계(첫 FROM 단계) COPY 원본 경로만 골라, 그중 .dockerignore 가 빼는 것을 뺀
//   복사본을 임시 폴더에 만든다(파일은 작업 트리의 추적 + 무시 안 된 새 파일). node_modules 는 원본을 가리키는 링크로 채운 뒤
//   그 앱의 typecheck 스크립트(tsc …)를 복사본에서 돌린다.
//   COPY 범위와 뺄 목록은 Dockerfile·.dockerignore 를 그대로 읽는다 — 따로 적지 않아 어긋나지 않는다.
// 대상: 인자가 없으면 DEFAULT_APPS. 앱마다 package.json 의 typecheck 가 `tsc …` 여야 한다.
//   mcp·ai-agent 는 이미지가 mcp-tools-shared 를 먼저 빌드(dist)해야 해 복사본에서 재현하지 않는다.
// 재현하지 않는 것: node_modules 는 전체 설치(루트 hoist)를 링크하므로, 이미지의 `pnpm install --filter <앱>...` 에 없는
//   의존성을 import 하는 경우는 잡지 못한다. vite build 단계만 겪는 해석 실패(?raw 자산 등)도 보지 않는다.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 인자 없이 돌릴 앱 — 이미지 빌드가 앱 소스를 그대로 읽어 tsc(collab 은 번들러)로 빌드하는 앱들. */
const DEFAULT_APPS = ['workplace-web', 'workplace-admin', 'workplace-collab']

/** node_modules 안에서 복사본에 링크하지 않을 항목 — tsc -b 의 tsbuildinfo(.tmp) 등 원본 캐시를 공유하면 검사를 건너뛰거나 원본을 덮는다. */
const SKIP_MODULE_ENTRIES = new Set(['.tmp', '.cache', '.vite'])

/**
 * .dockerignore 패턴 하나를 정규식으로 바꾼다(Docker 규칙: 루트 기준 경로, `**` 는 0개 이상 폴더,
 * `*`·`?`·`[…]` 는 한 폴더 안 — Go filepath.Match, `\` 는 다음 글자를 그대로).
 * 끝의 `/` 는 떼고(폴더도 같은 규칙으로 맞춘다), 앞의 `/` 도 뗀다.
 */
export function patternToRegExp(pattern) {
  const p = pattern.replace(/^\/+/, '').replace(/\/+$/, '')
  const escape = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') {
      // `**/` 는 0개 이상 폴더, 그 밖의 `**` 는 아래 전부
      if (p[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') {
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '[') {
      // 글자 묶음 — Go 의 부정 `^` 를 그대로 쓰고, 범위(a-z)·이스케이프(\x)는 정규식과 같다
      const end = p.indexOf(']', i + 2)
      if (end === -1) {
        re += '\\['
        continue
      }
      re += `(?!/)[${p.slice(i + 1, end)}]`
      i = end
    } else if (c === '\\' && i + 1 < p.length) {
      re += escape(p[i + 1])
      i += 1
    } else {
      re += escape(c)
    }
  }
  return new RegExp(`^${re}$`)
}

/** .dockerignore 본문 → 규칙 목록({ negate, re }). 빈 줄·주석(#)은 버린다. */
export function parseDockerignore(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!')
      return { negate, re: patternToRegExp(negate ? line.slice(1).trim() : line) }
    })
}

/**
 * 저장소 루트 기준 경로(`/` 구분)가 이미지 빌드 문맥에서 빠지는가.
 * Docker 처럼 뒤 규칙이 앞 규칙을 이기고, 폴더가 빠지면 그 아래 파일도 빠진다(경로와 모든 상위 폴더를 규칙에 대 본다).
 */
export function isExcluded(relPath, rules) {
  const parts = relPath.split('/')
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('/'))
  let excluded = false
  for (const rule of rules) {
    if (candidates.some((c) => rule.re.test(c))) excluded = !rule.negate
  }
  return excluded
}

/**
 * Dockerfile 빌드 단계(첫 FROM 부터 다음 FROM 전까지)의 문맥 COPY 원본 경로를 돌려준다(끝 `/` 뗌).
 * 복사본은 저장소와 같은 배치를 쓰므로 COPY 는 원본과 같은 자리(WORKDIR 기준 `./<원본 폴더>`)에 놓아야 한다 —
 * 다르면 이 검사가 이미지와 다른 배치를 보게 되니 오류로 알린다. `isDir(원본)` 은 원본이 폴더인지 답한다.
 */
export function buildStageCopySources(dockerfile, isDir) {
  const lines = dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/)
  const sources = []
  let stage = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (/^FROM\s/i.test(line)) stage++
    if (stage !== 1 || !/^COPY\s/i.test(line)) continue
    const args = line.split(/\s+/).slice(1)
    if (args.some((a) => a.startsWith('--from'))) continue
    const paths = args.filter((a) => !a.startsWith('--'))
    const dest = paths.pop().replace(/^\.\//, '').replace(/\/+$/, '') || '.'
    for (const src of paths.map((s) => s.replace(/^\.\//, '').replace(/\/+$/, ''))) {
      const expected = isDir(src) ? src : path.posix.dirname(src)
      if (dest !== expected) throw new Error(`Dockerfile COPY 가 원본과 다른 자리에 놓습니다(${src} → ${dest}) — 검사가 이 배치를 재현하지 못합니다`)
      sources.push(src)
    }
  }
  return sources
}

/** 경로가 COPY 원본(파일이거나 그 아래) 중 하나에 드는가. */
function isCopied(relPath, sources) {
  return sources.some((s) => relPath === s || relPath.startsWith(`${s}/`))
}

/**
 * 원본 node_modules 의 항목을 복사본 node_modules 에 링크한다.
 * pnpm 의 상대 링크(../../node_modules/.pnpm/…, 워크스페이스 패키지 ../../packages/…)는 같은 상대 경로로 다시 만들어
 * 복사본 안을 가리키게 하고(워크스페이스 패키지도 걸러진 복사본을 읽는다), 실제 폴더·파일(.pnpm 등)은 원본 절대 경로로 링크한다.
 */
function linkModules(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true })
  for (const name of fs.readdirSync(srcDir)) {
    if (SKIP_MODULE_ENTRIES.has(name)) continue
    const src = path.join(srcDir, name)
    const dst = path.join(dstDir, name)
    const stat = fs.lstatSync(src)
    if (stat.isSymbolicLink()) {
      // 링크 대상을 그대로 — 상대 링크는 복사본 안을, 절대 링크는 원래 곳을 가리킨다
      fs.symlinkSync(fs.readlinkSync(src), dst)
    } else if (stat.isDirectory() && name.startsWith('@')) {
      // 스코프 폴더(@types 등)는 실제 폴더 — 안의 패키지 링크를 하나씩 다시 만든다
      linkModules(src, dst)
    } else {
      fs.symlinkSync(src, dst)
    }
  }
}

/** 저장소 파일 목록 — 작업 트리의 추적 파일 + 무시 안 된 새 파일(지운 추적 파일은 뺀다). */
function listRepoFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return [...new Set(listed.split('\0').filter(Boolean))].filter((rel) => {
    const abs = path.join(root, rel)
    return fs.existsSync(abs) && fs.lstatSync(abs).isFile()
  })
}

/** 앱 하나의 복사본을 만든다 — Dockerfile 빌드 단계가 COPY 하고 .dockerignore 가 빼지 않는 파일만 복사하고 node_modules 를 링크한다. */
function buildContext(root, app, files, rules, outDir) {
  const dockerfile = fs.readFileSync(path.join(root, 'apps', app, 'Dockerfile'), 'utf8')
  const sources = buildStageCopySources(dockerfile, (src) => {
    const abs = path.join(root, src)
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory()
  })
  let copied = 0
  for (const rel of files) {
    if (!isCopied(rel, sources) || isExcluded(rel, rules)) continue
    const dst = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(root, rel), dst)
    copied++
  }
  // 루트와, 복사본에 들어간 워크스페이스 패키지(apps/*, packages/*)의 node_modules
  const moduleDirs = ['.']
  for (const group of ['apps', 'packages']) {
    if (!fs.existsSync(path.join(outDir, group))) continue
    for (const name of fs.readdirSync(path.join(outDir, group))) moduleDirs.push(path.join(group, name))
  }
  for (const dir of moduleDirs) {
    const src = path.join(root, dir, 'node_modules')
    if (fs.existsSync(src)) linkModules(src, path.join(outDir, dir, 'node_modules'))
  }
  return copied
}

/**
 * 앱 하나를 복사본에서 검사한다 — package.json 의 typecheck(`tsc …`)를 앱의 typescript 로 그대로 돌린다.
 * 돌려준다: 'ok' | 'type-error' — 검사를 돌릴 수 없으면(tsc 없음·실행 실패) 타입 오류와 섞이지 않게 예외로 알린다.
 */
function checkApp(contextDir, app) {
  const appDir = path.join(contextDir, 'apps', app)
  const pkgPath = path.join(appDir, 'package.json')
  if (!fs.existsSync(pkgPath)) throw new Error(`apps/${app}/package.json 이 복사본에 없습니다(Dockerfile COPY 확인)`)
  const script = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts?.typecheck ?? ''
  const [cmd, ...args] = script.trim().split(/\s+/)
  if (cmd !== 'tsc') throw new Error(`apps/${app} 의 typecheck 가 tsc 가 아닙니다: ${script}`)
  const tsc = path.join(appDir, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tsc)) throw new Error(`apps/${app}/node_modules/typescript 가 없습니다 — pnpm install 을 먼저 하세요`)
  console.log(`[image-typecheck] apps/${app}: tsc ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [tsc, ...args], { cwd: appDir, stdio: 'inherit' })
  if (result.error || result.signal) throw new Error(`apps/${app} 의 tsc 를 실행하지 못했습니다: ${result.error?.message ?? result.signal}`)
  return result.status === 0 ? 'ok' : 'type-error'
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const apps = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_APPS
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'image-typecheck-'))
  const cleanup = () => fs.rmSync(tmpRoot, { recursive: true, force: true })
  // Ctrl-C·CI 취소에도 임시 복사본을 남기지 않는다(finally 는 신호로 끝날 때 돌지 않는다)
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      cleanup()
      process.exit(130)
    })
  }
  try {
    const rules = parseDockerignore(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8'))
    const files = listRepoFiles(root)
    const failed = []
    for (const app of apps) {
      const contextDir = path.join(tmpRoot, app)
      const copied = buildContext(root, app, files, rules, contextDir)
      console.log(`[image-typecheck] apps/${app}: Dockerfile COPY 중 .dockerignore 를 뺀 ${copied}개 파일로 검사합니다`)
      if (checkApp(contextDir, app) !== 'ok') failed.push(app)
    }
    if (failed.length) {
      console.error(
        `[image-typecheck] 실패: ${failed.join(', ')} — 이미지 빌드(Dockerfile COPY 범위, .dockerignore 로 테스트 파일·src/test/ 가 빠짐)에서도 깨집니다.\n` +
          '  테스트 아닌 파일이 src/test/ 나 *.test.ts 를, 또는 Dockerfile 이 COPY 하지 않는 파일을 import 하고 있지 않은지 보세요.',
      )
      process.exitCode = 1
    } else {
      console.log('[image-typecheck] 통과')
    }
  } catch (err) {
    console.error(`[image-typecheck] 검사를 돌리지 못했습니다: ${err.message}`)
    process.exitCode = 2
  } finally {
    cleanup()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
