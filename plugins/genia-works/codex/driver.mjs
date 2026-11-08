#!/usr/bin/env node
// gw-codex-loop 의 본체(WP-1295) — Codex 로 work-loop 를 반복한다. 칸(agent-project start, 실행기 codex)이 이 구동기를 띄운다.
//   node driver.mjs <work-loop 인자…>   예: node driver.mjs WP --queue "AI 개발팀"
// 하는 일(genia 확장과 같은 규칙 — 반복 상태 기계는 genia/loop.js 의 LoopDriver, 바깥 구동기 공용 뼈대는 genia/external-driver.mjs 다.
// 여기에는 한 회차를 부르는 법만 둔다, WP-1410):
//   - 부르기: 쉬고 있을 때만 `codex exec`(처음)·`codex exec resume <대화>`(그 뒤)로 work-loop 스킬을 한 번 부른다. 마지막 답의
//     GW-NEXT-CHECK 로 다음 확인을 잡는다. none 이면 checkStop 으로 신원·상태(gw-status)를 확인해 멈출 까닭(신원 아님·DRAIN·RESTART)일 때만
//     멈추고, 그 밖(RUN·확인 실패)이면 잘못 쓴 none 으로 보고 20분 뒤 다시 본다(WP-1425).
//   - 깨우기: 알림 감시(agent-events tail·gw-events)를 자식으로 띄워 wake 줄마다 부른다 — 부르는 중이면 끝난 뒤 한 번.
//   - 신원·키: 이 칸 신원(GENIA_WORKS_AS)의 AI 키를 gw-lib 로 읽어 codex 프로세스의 환경 변수로만 넘긴다(명령줄·셸 도구에는 없다).
//     키 저장소·헤더 스크립트에 닿는 도구 호출은 PreToolUse hook(guard.mjs)이 막는다.
// 환경: GENIA_WORKS_MCP_URL(없으면 운영), GENIA_WORKS_TENANT, GENIA_WORKS_AGENT_DIR(start-agent 칸), GW_CODEX(테스트용 codex 경로).
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { runExternalDriver } from '../genia/external-driver.mjs'
import { shellQuote } from '../genia/loop.js'
import { TOKEN_ENV, codexArgs, progressSummaryFrom, threadIdFrom } from './lib.mjs'

runExternalDriver({
  name: 'codex',
  command: 'gw-codex-loop',
  setup: ({ root, log, version, mcpUrl, tenant, prompt, env }) => {
    const work = mkdtempSync(join(tmpdir(), 'gw-codex-'))
    const outFile = join(work, 'last.txt')
    let thread
    return {
      run(loopArgs, key) {
        rmSync(outFile, { force: true })
        const argv = codexArgs({
          thread,
          outFile,
          mcpUrl,
          tenant,
          guardCommand: 'node ' + shellQuote(join(root, 'codex', 'guard.mjs')),
          prompt: prompt(loopArgs),
          version,
        })
        log(thread ? `work-loop 부름(대화 ${thread} 이어서)` : 'work-loop 부름(새 대화)')
        log('Codex 회차 시작 — 진행 상황을 기다립니다')
        // --json 은 줄 단위로 읽어 대화 id 와 허용된 진행 요약만 기록한다 — 원시 출력은 쌓거나 로그하지 않는다.
        // 찾은 뒤에도 끝까지 읽어 버린다(읽기를 멈추면 파이프가 차서 codex 가 멈춘다).
        let id
        const child = spawn(process.env.GW_CODEX || 'codex', argv, { env: env({ [TOKEN_ENV]: key }), stdio: ['ignore', 'pipe', 'inherit'] })
        createInterface({ input: child.stdout }).on('line', (line) => {
          if (!id) id = threadIdFrom(line)
          const summary = progressSummaryFrom(line)
          if (summary) log(summary)
        })
        return {
          child,
          finish(code) {
            if (id) thread = id
            // 이어 받기에 실패하면 다음엔 새 대화로 — 지워진 대화를 계속 붙잡지 않게.
            else if (code !== 0) thread = undefined
            try {
              return readFileSync(outFile, 'utf8')
            } catch {
              return '' // 마지막 답이 없으면(실패) 기본 간격으로 다시 본다.
            }
          },
        }
      },
      shutdown: () => rmSync(work, { recursive: true, force: true }),
    }
  },
})
