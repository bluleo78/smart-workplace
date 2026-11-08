#!/usr/bin/env node
// gw-opencode-loop 의 본체(WP-1410) — OpenCode 로 work-loop 를 반복한다. 칸(agent-project start, 실행기 opencode)이 이 구동기를 띄운다.
//   node driver.mjs <work-loop 인자…>   예: node driver.mjs WP --queue "AI 개발팀"
// Codex 구동기(codex/driver.mjs)와 같은 뼈대(genia/external-driver.mjs — 반복 상태 기계는 genia/loop.js 의 LoopDriver)를 쓰고, 여기에는
// 한 회차를 부르는 법만 둔다:
//   - 부르기: 쉬고 있을 때만 `opencode run`(처음)·`opencode run -s <세션>`(그 뒤)으로 work-loop 스킬을 한 번 부른다. 마지막 답의
//     GW-NEXT-CHECK 로 다음 확인을 잡는다. none 이면 checkStop 으로 신원·상태를 확인해 멈출 까닭일 때만 멈춘다(WP-1425).
//   - 깨우기: 알림 감시(agent-events tail·gw-events)를 자식으로 띄워 wake 줄마다 부른다 — 부르는 중이면 끝난 뒤 한 번.
//   - 신원·키: 이 칸 신원(GENIA_WORKS_AS)의 AI 키를 gw-lib 로 읽어 opencode 프로세스의 환경 변수로만 넘긴다(명령줄·설정 내용에는 없다).
//     셸 도구의 환경에서는 키 보호 플러그인(guard-plugin.js)이 그 변수를 비우고, 키 저장소·헤더 스크립트에 닿는 도구 호출을 막는다.
// 환경: GENIA_WORKS_MCP_URL(없으면 운영), GENIA_WORKS_TENANT, GENIA_WORKS_AGENT_DIR(start-agent 칸), GW_OPENCODE(테스트용 opencode 경로).
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { runExternalDriver } from '../genia/external-driver.mjs'
import { RunReader, TOKEN_ENV, configContent, isSessionNotFound, nextSession, opencodeArgs } from './lib.mjs'

runExternalDriver({
  name: 'opencode',
  command: 'gw-opencode-loop',
  setup: ({ root, log, version, mcpUrl, tenant, prompt, env }) => {
    let session
    return {
      run(loopArgs, key) {
        const argv = opencodeArgs({ session, prompt: prompt(loopArgs) })
        const childEnv = env({
          [TOKEN_ENV]: key,
          OPENCODE_CONFIG_CONTENT: configContent({
            mcpUrl,
            tenant,
            version,
            guardPluginPath: join(root, 'opencode', 'guard-plugin.js'),
          }),
        })
        log(session ? `work-loop 부름(세션 ${session} 이어서)` : 'work-loop 부름(새 세션)')
        log('OpenCode 회차 시작 — 진행 상황을 기다립니다')
        // --format json 은 줄 단위로 읽어 세션 id·마지막 답·허용된 진행 요약만 남긴다 — 원시 출력은 쌓거나 로그하지 않는다.
        // 끝까지 읽어 버린다(읽기를 멈추면 파이프가 차서 opencode 가 멈춘다). stdin 은 닫아 둔다 — 열린 파이프면 opencode 가 시작하지 않는다(11-08 실측).
        const reader = new RunReader()
        const child = spawn(process.env.GW_OPENCODE || 'opencode', argv, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
        createInterface({ input: child.stdout }).on('line', (line) => {
          const summary = reader.add(line)
          if (summary) log(summary)
        })
        // stderr 는 그대로 칸에 흘려보내고, 이어 받을 세션이 없다는 오류만 알아 둔다(그때만 다음 회차를 새 세션으로).
        let notFound = false
        createInterface({ input: child.stderr }).on('line', (line) => {
          process.stderr.write(line + '\n')
          if (isSessionNotFound(line)) notFound = true
        })
        return {
          child,
          finish() {
            // 없는 세션이면(출력 없이 「Session not found」) 다음엔 새 세션으로 — 지워진 세션을 계속 붙잡지 않게. 출력 없이 끝난 다른
            // 실패(모델 서버 잠깐 장애 등)는 세션을 그대로 둬 work-loop 맥락을 잃지 않는다. 세션 안의 오류(문맥 넘침 등)는 새 세션으로.
            session = nextSession({ previous: session, seen: reader.session, notFound, failed: reader.failed })
            // 단계 도중에 끝났으면 그 단계의 글을 답으로 굳힌다(RunReader.finish).
            reader.finish()
            return reader.answer
          },
        }
      },
    }
  },
})
