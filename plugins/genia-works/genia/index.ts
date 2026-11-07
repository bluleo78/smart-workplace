// genia-works — Gen:iA Code(genia) 확장(WP-1294). Claude Code 플러그인(같은 폴더)의 스킬·스크립트를 그대로 쓰고, Claude 쪽 mod(hooks/register.js)와
// /loop·Monitor 가 하던 일을 genia 확장 API 로 한다:
//   - MCP 연결: genia-works 서버를 이 세션 신원으로 등록한다(AI 키는 헤더 스크립트가 연결할 때마다 읽는다 — 키가 env·명령줄에 남지 않는다).
//   - 반복: /gw-loop <프로젝트 키> [--queue "<라벨>"] — 쉬고 있을 때 work-loop 를 한 번 부르고, 마지막 줄 GW-NEXT-CHECK 로 다음 확인을 잡는다
//     (none 은 신원·상태를 확인해 멈출 까닭일 때만 따른다 — WP-1425).
//   - 깨우기: 알림 감시(agent-events tail·gw-events)를 자식으로 띄워 wake 줄마다 부른다(일하는 중이면 끝난 뒤 한 번).
//   - 키 보호: 키 저장소·헤더 스크립트에 닿는 도구 호출을 막고, 키 모양이 든 입력을 버린다. 내 토큰(GENIA_WORKS_TOKEN)은 받아 둔 뒤 환경에서 지운다
//     (bash 도구가 물려받지 않게).
//   - 신원: /gw-as <AI 이름|me>·/gw-logout — 세션 선택을 바꾸고 MCP 를 다시 등록한다. /gw-login 은 키 등록 방법을 알린다. 상태 줄에 AI 신원을 보인다.
// 판단(반복 상태·차단 판정·MCP 설정 모양)은 loop.js 의 순수 함수에 두고 node --test 로 검증한다. 이 파일은 genia 연결만 한다.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LoopDriver,
  GENIA_COMMANDS,
  checkStop,
  noneDecisionMessage,
  GENIA_PROMPT_KEY_DROP,
  conflictingMcpEntry,
  mcpConfig,
  projectKeyOf,
  promptHasSecret,
  toolBlockReason,
  watchEvents,
} from './loop.js'
import { aiPick, parseKeyList, statusLabel, validName } from '../hooks/lib.js'

const SERVER = 'genia-works'
const DEFAULT_URL = 'https://genia-works.iacloud.kr/mcp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = join(root, 'scripts')
const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version as string
  } catch {
    return '0'
  }
})()

// 내 토큰은 시작 때 받아 두고 환경에서 지운다 — genia 의 bash 도구가 process.env 를 물려줘 모델이 읽을 수 있었다(11-02 시험).
const myToken = process.env.GENIA_WORKS_TOKEN
delete process.env.GENIA_WORKS_TOKEN

// 마지막 assistant 답의 글 — agent_end 의 messages 에서 뽑는다(모양이 바뀌어도 text 조각만 모은다).
function lastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown }
    if (m?.role !== 'assistant') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content
        .map((c: any) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
        .join('\n')
    }
  }
  return ''
}

export default function (genia: any) {
  // 플러그인 스크립트 실행(키 저장소·세션 선택은 스크립트만 다룬다). genia.exec 의 자식이라 스크립트가 이 genia 를 「이 세션」으로 찾는다.
  const script = (name: string, args: string[] = []) =>
    genia.exec(join(scripts, name), args).catch(() => ({ code: 1, stdout: '', stderr: '' }))

  // 지금 신원 — 세션 선택 > GENIA_WORKS_AS(헤더 스크립트와 같은 우선순위). 키 있음 여부도 함께(상태 줄).
  async function identity() {
    const shown = await script('gw-session', ['show'])
    const selected = shown.code === 0 ? String(shown.stdout).trim() : ''
    const as = process.env.GENIA_WORKS_AS ?? ''
    const pick = aiPick({ selected, as })
    const keyMissing = Boolean(pick) && (await script('gw-keys', ['has', pick])).code !== 0
    return { selected, as, pick, keyMissing, hasEnvToken: Boolean(myToken), hasToken: Boolean(myToken) }
  }

  async function registerServer() {
    const id = await identity()
    genia.registerMcpServer(
      SERVER,
      mcpConfig({
        url: process.env.GENIA_WORKS_MCP_URL || DEFAULT_URL,
        scriptsDir: scripts,
        aiIdentity: id.pick,
        myToken,
        tenant: process.env.GENIA_WORKS_TENANT,
        version: pluginVersion,
      }),
    )
    return id
  }

  let ctxRef: any
  // 첫 등록이 끝났는지 — /gw-loop 가 시작 명령으로 바로 오더라도 MCP 등록(신원 읽기) 뒤에 부르게 한다.
  let ready: Promise<unknown> = Promise.resolve()
  function showStatus(id: Awaited<ReturnType<typeof identity>>) {
    const label = statusLabel(id)
    ctxRef?.ui?.setStatus?.('genia-works', label ? 'genia-works: ' + label.replace('/genia-works:login', '/' + GENIA_COMMANDS.login) : undefined)
  }

  // ---- 반복·깨우기
  let lastText = ''
  const driver = new LoopDriver({
    run: (args: string) => {
      // 쉬는 세션에 실행을 넣는다 — /skill:work-loop 은 스킬 펼치기가 필요해 expandPromptTemplates 를 켠다.
      genia.sendUserMessage(`/skill:work-loop ${args}`, { expandPromptTemplates: true })
    },
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (h: ReturnType<typeof setTimeout>) => clearTimeout(h),
    // none 확인(WP-1425) — 신원·상태를 확인해 멈출 까닭일 때만 멈춘다(자세한 것은 loop.js checkStop 설명).
    checkStop: ({ nextCheckAt }: { nextCheckAt: string }) => checkStop({ scriptsDir: scripts, nextCheckAt }),
    // 확인 결과를 한 줄로 알린다 — 멈추면 경고, 계속 돌면 안내.
    onDecision: (d: { action: string }) => {
      if (shuttingDown) return
      ctxRef?.ui?.notify?.(noneDecisionMessage(d), d.action === 'none' ? 'warning' : 'info')
    },
  })

  // 알림 감시(loop.js watchEvents) — 띄우기·줄 나누기·재시작·그룹째 끝내기는 Codex 구동기와 같은 것을 쓴다.
  let events: ReturnType<typeof watchEvents> | undefined
  let eventsFatal = false
  let shuttingDown = false

  function startEvents(projectKey: string) {
    // 떠 있는 감시가 있으면 그대로 둔다. 재시작을 기다리는 중이면 그 감시를 멈추고 이 프로젝트 키로 바로 다시 띄운다(예전과 같다).
    if (events?.running || eventsFatal || shuttingDown) return
    events?.stop()
    events = watchEvents({
      scriptsDir: scripts,
      agentDir: process.env.GENIA_WORKS_AGENT_DIR,
      projectKey,
      onWake: () => driver.wake(),
      onFatal: (line: string) => {
        // AI 키 신원이 아님·인증 실패 — 다시 띄우지 않고 주기 확인만 한다(work-loop 5번과 같다). /gw-loop 를 다시 불러도 띄우지 않는다.
        eventsFatal = true
        ctxRef?.ui?.notify?.(line, 'warning')
      },
      // 재시작 조건은 두지 않는다 — 예전 조건(driver.args)은 /gw-loop 를 부른 뒤로 늘 참이었고, 끝낼 때는 stopEvents 가 재시작을 막는다.
      // none 으로 멈춰 인자가 비어도 감시는 계속 되살린다(그 사이 깨움은 LoopDriver 가 무시한다).
    })
  }

  function stopEvents() {
    events?.stop()
    events = undefined
  }

  // ---- 명령
  genia.registerCommand(GENIA_COMMANDS.loop, {
    description: 'genia-works work-loop 반복 — /gw-loop <프로젝트 키> [--queue "<라벨>"]',
    handler: async (args: string, ctx: any) => {
      ctxRef = ctx
      const key = projectKeyOf(args)
      if (!key) {
        ctx.ui.notify('사용: /' + GENIA_COMMANDS.loop + ' <프로젝트 키> [--queue "<라벨>"]', 'error')
        return
      }
      await ready
      startEvents(key)
      driver.start(String(args).trim())
    },
  })

  genia.registerCommand(GENIA_COMMANDS.as, {
    description: 'genia-works 접속 신원 전환 — /gw-as <AI 이름|me> (인자 없으면 지금 신원)',
    handler: async (args: string, ctx: any) => {
      ctxRef = ctx
      const name = String(args ?? '').trim()
      if (!name) {
        const id = await identity()
        ctx.ui.notify('genia-works 신원: ' + (id.pick || (myToken ? '내 토큰' : '내 토큰 없음')), 'info')
        return
      }
      if (name !== 'me' && !validName(name)) {
        ctx.ui.notify('AI 이름 형식이 아닙니다: ' + name, 'error')
        return
      }
      if (name !== 'me' && (await script('gw-keys', ['has', name])).code !== 0) {
        ctx.ui.notify(`'${name}' 키가 없습니다 — /${GENIA_COMMANDS.login}`, 'error')
        return
      }
      const r = await script('gw-session', ['select', name])
      if (r.code !== 0) {
        ctx.ui.notify('신원을 바꾸지 못했습니다', 'error')
        return
      }
      // 다시 등록하면 genia 가 곧바로 다시 연결해 헤더(신원)를 새로 읽는다(11-03 실측).
      showStatus(await registerServer())
      ctx.ui.notify('genia-works 신원: ' + (name === 'me' ? '내 토큰' : name), 'info')
    },
  })

  genia.registerCommand(GENIA_COMMANDS.logout, {
    description: 'genia-works 로그아웃 — 이 세션을 내 토큰으로 되돌림',
    handler: async (_args: string, ctx: any) => {
      ctxRef = ctx
      await script('gw-session', ['select', 'me'])
      showStatus(await registerServer())
      ctx.ui.notify('genia-works 신원: 내 토큰', 'info')
    },
  })

  genia.registerCommand(GENIA_COMMANDS.login, {
    description: 'genia-works AI 키 목록과 등록 방법',
    handler: async (_args: string, ctx: any) => {
      ctxRef = ctx
      const keys = parseKeyList(String((await script('gw-keys', ['list'])).stdout ?? ''))
      const list = keys.length ? keys.map((k) => k.name).join(', ') : '없음'
      // 키는 대화·입력 창에 넣지 않는다 — 터미널에서 표준 입력으로만 받는다(Claude Code 의 로그인 패널과 같은 저장소를 쓴다).
      ctx.ui.notify(
        `등록된 AI 키: ${list}. 새 키는 터미널에서 '${join(scripts, 'gw-keys')}' add <AI 이름> 을 실행하고 키를 붙여 넣은 뒤 /${GENIA_COMMANDS.as} <AI 이름> 으로 고르세요`,
        'info',
      )
    },
  })

  // ---- 이벤트
  genia.on('session_start', async (_e: any, ctx: any) => {
    ctxRef = ctx
    ready = registerServer().then(showStatus)
    await ready
    // 손으로 적은 genia-works 항목(11-02 시험 방식 — 토큰 env)이 남아 있으면 그쪽이 먼저 쓰인다 — 지우라고 알린다(설정 파일은 고치지 않는다).
    for (const file of [join(process.env.GENIA_CODING_AGENT_DIR || join(homedir(), '.genia', 'agent'), 'mcp.json'), join(ctx?.cwd ?? process.cwd(), '.genia', 'mcp.json')]) {
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const name = conflictingMcpEntry(text)
      if (name) {
        ctx.ui.notify(`${file} 에 적힌 MCP 서버 ${name} 때문에 genia-works 확장의 연결이 가려집니다 — genia mcp remove ${name} 로 지우세요`, 'warning')
      }
    }
  })

  genia.on('session_shutdown', async () => {
    shuttingDown = true
    driver.stop()
    stopEvents()
  })

  genia.on('agent_start', async () => {
    driver.busy()
  })

  genia.on('agent_end', async (e: any) => {
    lastText = lastAssistantText(e?.messages)
  })

  genia.on('agent_settled', async (_e: any, ctx: any) => {
    ctxRef = ctx
    driver.settled(lastText)
    lastText = ''
  })

  genia.on('tool_call', async (e: any) => {
    const reason = toolBlockReason(e.toolName, e.input)
    if (reason) return { block: true, reason }
  })

  genia.on('input', async (e: any, ctx: any) => {
    if (promptHasSecret(e.text)) {
      ctx.ui.notify(GENIA_PROMPT_KEY_DROP, 'error')
      return { action: 'handled' }
    }
    return { action: 'continue' }
  })
}
