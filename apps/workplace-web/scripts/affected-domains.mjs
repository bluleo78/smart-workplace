#!/usr/bin/env node
// pre-commit.sh 의 FORCE_FULL(공유영역) 판정을 의존성 그래프로 정밀화하기 위한 헬퍼.
// 변경된 공유 파일(components/lib/hooks/types)이 실제로 어떤 도메인 페이지에서
// 참조되는지 역추적해, 영향받는 도메인 목록 또는 ALL(폴백) 을 stdout 에 출력한다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALL = 'ALL'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(__dirname, '..')

// 전방 의존성 그래프(파일 -> 그 파일이 import 하는 파일들)를
// 역인접 맵(파일 -> 그 파일을 import 하는 파일들)으로 뒤집는다.
export function buildReverseGraph(graphObj) {
  const reverse = new Map()
  for (const [file, deps] of Object.entries(graphObj)) {
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, new Set())
      reverse.get(dep).add(file)
    }
  }
  return reverse
}

// src/pages 서브디렉토리 이름 = 알려진 도메인 목록.
export function getKnownDomains(webRoot) {
  const pagesDir = path.join(webRoot, 'src/pages')
  return fs
    .readdirSync(pagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

// changedFiles(그래프 기준 상대경로, 예: 'components/ui/button.tsx') 각각에 대해
// 역방향 BFS 로 도달 가능한 'pages/**' 파일을 찾아 도메인으로 매핑한다.
// 매핑 불가(톱레벨 flat 페이지) 또는 그래프에 없는 변경 파일은 안전하게 ALL 로 폴백한다.
export function computeAffectedDomains(changedFiles, { graphObj, reverseGraph, domains }) {
  const domainSet = new Set(domains)
  const affected = new Set()

  for (const changedFile of changedFiles) {
    if (!(changedFile in graphObj) && !reverseGraph.has(changedFile)) {
      return [ALL]
    }

    const visited = new Set([changedFile])
    const queue = [changedFile]
    while (queue.length > 0) {
      const current = queue.shift()
      const importers = reverseGraph.get(current)
      if (!importers) continue
      for (const importer of importers) {
        if (visited.has(importer)) continue
        visited.add(importer)
        queue.push(importer)
      }
    }

    let foundPage = false
    for (const file of visited) {
      if (!file.startsWith('pages/')) continue
      foundPage = true
      const match = file.match(/^pages\/([^/]+)\//)
      if (!match || !domainSet.has(match[1])) {
        return [ALL]
      }
      affected.add(match[1])
    }

    // pages/** 를 하나도 못 찾았는데 그래프 루트(main.tsx)까지 도달했다면,
    // 라우터 Outlet 합성처럼 정적 import 그래프가 실제 소비 관계를 못 담는 경우다.
    // (그래프에 없어 미매핑된 죽은 코드와 구분: 이 경우는 진짜로 앱에서 쓰이는 파일이므로 안전하게 ALL.)
    if (!foundPage && visited.has('main.tsx')) {
      return [ALL]
    }
  }

  return [...affected].sort()
}

async function main() {
  const repoRootRelativeFiles = process.argv.slice(2)
  if (repoRootRelativeFiles.length === 0) {
    return
  }

  const webRelativePrefix = 'apps/workplace-web/src/'
  const changedFiles = []
  for (const f of repoRootRelativeFiles) {
    if (!f.startsWith(webRelativePrefix)) {
      // 예상 밖 입력(호출부 버그) — 안전하게 폴백.
      console.log(ALL)
      return
    }
    changedFiles.push(f.slice(webRelativePrefix.length))
  }

  const { default: madge } = await import('madge')
  const res = await madge(path.join(WEB_ROOT, 'src/main.tsx'), {
    fileExtensions: ['ts', 'tsx'],
    tsConfig: path.join(WEB_ROOT, 'tsconfig.app.json'),
  })
  const graphObj = res.obj()
  const reverseGraph = buildReverseGraph(graphObj)
  const domains = getKnownDomains(WEB_ROOT)

  const result = computeAffectedDomains(changedFiles, { graphObj, reverseGraph, domains })
  console.log(result.join(' '))
}

// 테스트에서 import 될 때는 CLI 를 실행하지 않는다.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
