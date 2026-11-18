#!/usr/bin/env node
// AI 세션 토큰 사용 측정 (WP-1714) — `node scripts/agent-token-usage.mjs <폴더>`
// 쓰임: WP-1713(AI 운영 효율화) 변경 전·후에 Pod/AI 별 토큰 사용을 사람이 비교한다.
// 복사 방법: `kubectl cp <pod>:/home/agent/.claude <폴더>/<이름>` (이름 = Pod/AI 구분용 폴더명)
// 입력: <폴더>/<이름>/projects/**/*.jsonl 의 type "assistant" 줄. 같은 (message.id, requestId) 는 한 번만 센다
//   (스트리밍·재시도로 같은 응답이 여러 줄 남기 때문 — 파일 단위로 제거).
// 출력: 이름·날짜(UTC, timestamp 앞 10자)·하위 여부(경로에 subagents 가 있거나 isSidechain)마다
//   호출 수·평균 컨텍스트(input+cache_creation+cache_read)·캐시 읽기 합·출력 합 — 탭 구분 표, 헤더 한 줄.
// 가격(비용) 계산은 하지 않는다 — 모델별 단가가 자주 바뀌어 값이 금방 틀어지기 때문이다.
import fs from 'node:fs'
import path from 'node:path'

import { isMainModule } from '../deploy/release/lib/cli.mjs'

/** 디렉터리 아래 .jsonl 파일을 재귀로 모은다(없으면 빈 배열). */
function findJsonl(dir) {
  if (!fs.existsSync(dir)) return []
  const found = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) found.push(...findJsonl(p))
    else if (e.isFile() && e.name.endsWith('.jsonl')) found.push(p)
  }
  return found
}

/**
 * <root>/<이름>/projects/**\/*.jsonl 의 assistant 줄을 중복 제거해 행 배열로 읽는다.
 * 행: { name, day, sub, context, cacheRead, output } — usage 없는 줄·깨진 JSON 줄은 건너뛴다.
 */
export function readRows(root) {
  const rows = []
  const names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  for (const name of names) {
    for (const file of findJsonl(path.join(root, name, 'projects')).sort()) {
      const inSubagents = file.split(path.sep).includes('subagents')
      // 키 → rows 안 위치. 스트리밍 응답은 내용 블록마다 줄이 하나씩 써져 앞 줄의 output_tokens 가 일부일 수 있다 — 가장 큰 값을 남긴다.
      const seen = new Map()
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        let d
        try {
          d = JSON.parse(line)
        } catch {
          continue
        }
        const m = d?.message
        if (d?.type !== 'assistant' || !m?.usage) continue
        const key = `${m.id}\u0000${d.requestId}`
        const u = m.usage
        const prev = seen.get(key)
        if (prev !== undefined && (u.output_tokens ?? 0) <= rows[prev].output) continue
        const row = {
          name,
          day: String(d.timestamp ?? '').slice(0, 10),
          sub: inSubagents || d.isSidechain === true,
          context: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          cacheRead: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        }
        if (prev !== undefined) {
          rows[prev] = row
        } else {
          seen.set(key, rows.length)
          rows.push(row)
        }
      }
    }
  }
  return rows
}

/** 행을 이름·날짜·하위 여부로 묶어 호출 수·평균 컨텍스트(반올림)·캐시 읽기 합·출력 합을 낸다(이름·날짜·main→sub 순). */
export function summarize(rows) {
  const groups = new Map()
  for (const r of rows) {
    const k = `${r.name}\u0000${r.day}\u0000${r.sub}`
    const g = groups.get(k) ?? { name: r.name, day: r.day, sub: r.sub, calls: 0, ctx: 0, cacheRead: 0, output: 0 }
    g.calls += 1
    g.ctx += r.context
    g.cacheRead += r.cacheRead
    g.output += r.output
    groups.set(k, g)
  }
  return [...groups.values()]
    .map(({ ctx, ...g }) => ({ name: g.name, day: g.day, sub: g.sub, calls: g.calls, avgContext: Math.round(ctx / g.calls), cacheRead: g.cacheRead, output: g.output }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.day.localeCompare(b.day) || Number(a.sub) - Number(b.sub))
}

/** 탭 구분 표(헤더 한 줄 + 행)로 문자열화한다. */
export function formatTable(summary) {
  const lines = ['name\tday\tsub\tcalls\tavgContext\tcacheRead\toutput']
  for (const r of summary) lines.push([r.name, r.day, r.sub ? 'sub' : 'main', r.calls, r.avgContext, r.cacheRead, r.output].join('\t'))
  return lines.join('\n')
}

function main(args) {
  if (args.length !== 1) {
    console.error('사용법: node scripts/agent-token-usage.mjs <폴더>  (<폴더>/<이름>/projects/**/*.jsonl)')
    return 2
  }
  console.log(formatTable(summarize(readRows(args[0]))))
  return 0
}

// 직접 실행일 때만(테스트 import 제외)
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
