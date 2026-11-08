// genia-works 의 OpenCode 구동기(gw-opencode-loop)·키 보호 플러그인이 쓰는 순수 함수(WP-1410) — node --test 로 따로 검증한다.
// OpenCode 에도 genia 같은 세션 안 반복 API 가 없어, Codex 처럼 바깥 구동기가 `opencode run`(처음)·`opencode run -s <세션>`(그 뒤)으로
// work-loop 를 한 번씩 부른다. 11-08 실측(OpenCode 1.18.31):
//   - stdin 이 닫혀 있어야 시작한다(열린 파이프면 init 에서 영원히 기다림) — 구동기는 stdin 을 ignore 로 띄운다.
//   - --format json 은 줄 단위 JSON 이벤트(step_start·tool_use·text·step_finish)를 내고, 모든 이벤트에 sessionID 가 있다. 파일로 마지막 답을 받는 옵션은 없다.
//   - -s <세션> 으로 맥락이 이어진다. 없는 세션이면 출력 없이 종료 1(「Session not found」 — stderr). 구동기는 stderr 에서 이 문구를 볼 때만
//     세션을 버린다(nextSession) — 출력 없이 끝난 다른 실패(모델 서버 장애·설정 오류)는 세션을 그대로 둔다.
//   - 설정은 OPENCODE_CONFIG_CONTENT(인라인 JSON)가 전역 설정과 병합된다 — 사용자 설정 파일을 고치지 않고 MCP·무승인·키 보호 플러그인을 넘긴다.
import { pathToFileURL } from 'node:url'
import { TOKEN_ENV, safePreview, tenantHeader, toolBlockReason } from '../genia/loop.js'

// MCP 토큰 변수(loop.js 한 곳에서 정한다) — opencode 프로세스에만 넣고, 셸 도구에는 키 보호 플러그인(shell.env)이 빈 값으로 덮는다.
export { TOKEN_ENV }
// 셸 도구에 물려주지 않을 변수 — MCP 토큰과 사람의 내 토큰(구동기가 지우지만 사람이 opencode 를 직접 띄운 경우까지).
export const HIDDEN_ENV = [TOKEN_ENV, 'GENIA_WORKS_TOKEN']
const SERVER = 'genia-works'

/**
 * OPENCODE_CONFIG_CONTENT 값(JSON 문자열) — genia-works MCP(이 칸 신원의 키는 {env:…} 치환으로 — 값은 설정에 넣지 않는다.
 * 이 변수는 셸 도구도 물려받기 때문이다)·무승인 실행·키 보호 플러그인. 워크스페이스는 숫자일 때만 헤더로 붙인다(genia·Codex 와 같은 규칙).
 * User-Agent 를 opencode 로 두어 서버 작업 기록의 도구 이름이 opencode 로 남게 한다. 11-08 실측: {env:…} 가 실제 요청 헤더에 들어간다.
 */
export function configContent({ mcpUrl, tenant, version, guardPluginPath }) {
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    // 무승인 — bash 등 모든 도구를 묻지 않고 돌린다(사람이 지켜보지 않는 칸). 그래서 이 AI 전용 칸에서만 쓴다.
    permission: 'allow',
    // LSP·포매터는 끈다 — OpenCode 가 스스로 띄우는 이 프로세스들은 셸 도구가 아니라 shell.env 훅을 거치지 않아 AI 키 변수를 물려받고,
    // 저장소의 코드(포매터 플러그인·LSP 플러그인)를 읽어 돌린다. 이미지에 없는 언어 서버(jdtls 등)를 스스로 내려받지도 않게 한다.
    // 검사·포맷은 work-loop 가 저장소의 명령(pnpm lint·gradlew)으로 돌린다. 11-08 실측(1.18.31): `opencode debug config` 에 그대로 실린다.
    lsp: false,
    formatter: false,
    // 로컬 파일 플러그인은 file:// 주소로 — pathToFileURL 로 경로의 공백·한글을 바르게 감싼다.
    plugin: [pathToFileURL(guardPluginPath).href],
    mcp: {
      [SERVER]: {
        type: 'remote',
        url: mcpUrl,
        // 브라우저 로그인(OAuth) 대신 키 헤더 — 401 을 받아도 OAuth 창을 띄우려 하지 않게.
        oauth: false,
        headers: {
          Authorization: `Bearer {env:${TOKEN_ENV}}`,
          'User-Agent': 'opencode/genia-works-' + (version || '0'),
          ...tenantHeader(tenant),
        },
      },
    },
  })
}

/** opencode run 인자 — 세션 id 가 있으면 -s 로 이어 받는다. 프롬프트는 마지막 위치 인자다. */
export function opencodeArgs({ session, prompt }) {
  return ['run', '--format', 'json', ...(session ? ['-s', session] : []), prompt]
}

/** JSON 한 줄을 읽는다 — 객체가 아니면(깨진 줄·경고 등) undefined. */
function parseEvent(line) {
  try {
    const e = JSON.parse(line)
    return e && typeof e === 'object' && !Array.isArray(e) ? e : undefined
  } catch {
    return undefined
  }
}

/** 이벤트 객체에서 세션 id. 없으면 undefined. */
function sessionOf(e) {
  const id = e?.sessionID
  return typeof id === 'string' && id ? id : undefined
}

/** --format json 한 줄에서 세션 id. 없으면 undefined. */
export function sessionIdFrom(line) {
  return sessionOf(parseEvent(line))
}

/** 이어 받을 세션이 없다는 opencode 의 오류 문구(stderr) — 11-08 실측: 「Session not found」. */
export function isSessionNotFound(text) {
  return /session not found/i.test(String(text ?? ''))
}

/**
 * 회차가 끝난 뒤 다음에 이어 받을 세션 — 이어 받을 세션이 없다는 오류나 세션 안의 오류(failed)를 봤으면 새 세션(undefined), 아니면 이번
 * 회차에서 본 세션 id, 그것도 없으면(설정·네트워크·플러그인 오류로 출력 없이 끝남) 앞의 세션을 그대로 둔다 — 잠깐의 장애로 맥락을 버리지 않게.
 */
export function nextSession({ previous, seen, notFound, failed }) {
  // 세션 안에서 오류(error 이벤트)로 끝난 회차도 새 세션으로 — 모델 칸에 문맥 한도(limit.context)가 없어 OpenCode 가 스스로 줄이지(compact)
  // 않으므로, 문맥이 넘쳐 매 회차 같은 오류가 나는 세션을 계속 붙잡지 않게. work-loop 은 이슈 상태·챗에서 이어 받는다.
  if (notFound || failed) return undefined
  return seen ?? previous
}

/**
 * 한 회차의 출력 읽기 — 줄마다 add(line) 을 부르면 세션 id·마지막 답을 모으고, 기록할 진행 요약(없으면 undefined)을 돌려준다.
 *   session: 처음 본 sessionID. 출력 없이 끝나면 undefined — 다음 회차의 세션은 구동기가 nextSession 으로 정한다.
 *   answer:  마지막 답 — 한 단계(step_start ~ step_finish)가 메시지 하나다. 단계마다 text 파트를 모으고, reason 이 tool-calls 가
 *            아닌 step_finish(stop·length·other 등)에서 그 단계의 글을 답으로 굳힌다(tool-calls 로 끝난 중간 단계의 글은 버린다).
 *            회차가 단계 도중에 끝나면 finish() 가 그 단계의 글을 굳힌다. 여러 번이면 마지막 것, 없으면 ''.
 * 도구 출력·원시 이벤트는 쌓지 않는다.
 */
export class RunReader {
  #parts = []
  session = undefined
  answer = ''
  // 세션 안에서 오류(error 이벤트)를 봤는지 — 다음 회차를 새 세션으로 할지(nextSession) 정한다.
  failed = false

  add(line) {
    // 한 줄은 한 번만 읽는다 — 세션 id·답·진행 요약이 같은 이벤트 객체를 쓴다.
    const e = parseEvent(line)
    if (!e) return undefined
    if (!this.session) this.session = sessionOf(e)
    if (e.type === 'error') this.failed = true
    if (e.type === 'step_start') this.#parts = []
    else if (e.type === 'text' && typeof e.part?.text === 'string') this.#parts.push(e.part.text)
    else if (e.type === 'step_finish') {
      // tool-calls 로 끝난 단계는 도구를 부르고 이어지는 중간 단계라 글을 버린다. 그 밖(stop·length·other·unknown·reason 없음 등)은
      // 모델이 그 단계에서 멈춘 것이라 마지막 답 후보로 굳힌다 — stop 만 보면 다른 까닭으로 끝난 회차의 GW-NEXT-CHECK 를 잃는다.
      if (e.part?.reason !== 'tool-calls') this.answer = this.#parts.join('\n')
      this.#parts = []
    }
    return summaryOf(e)
  }

  /**
   * 회차 끝(프로세스 종료) — 단계가 step_finish 없이 끊겼으면 그 단계의 글을 답으로 굳힌다(끊기기 전에 GW-NEXT-CHECK 를 냈을 수 있다).
   * 모은 글이 없으면 앞서 굳힌 답을 그대로 둔다.
   */
  finish() {
    if (this.#parts.length) this.answer = this.#parts.join('\n')
    this.#parts = []
  }
}

/** 줄 목록의 마지막 답 — RunReader 를 한 번에 돌린다. */
export function lastAnswer(lines) {
  const r = new RunReader()
  for (const l of lines) r.add(l)
  r.finish()
  return r.answer
}

/**
 * OpenCode JSON 한 줄에서 허용된 진행 필드만 요약한다 — 도구 출력·MCP 인자와 결과·원시 이벤트는 읽지 않는다(Codex 구동기와 같은 규칙).
 * bash 는 명령(민감값을 가린 미리보기), todowrite 는 완료 수, 그 밖의 도구(MCP 포함 — 이름은 「<서버>_<도구>」)는 이름만, 답은 미리보기.
 */
export function progressSummaryFrom(line) {
  return summaryOf(parseEvent(line))
}

/** progressSummaryFrom 의 본체 — 이미 읽은 이벤트 객체를 받는다. */
function summaryOf(e) {
  if (!e) return undefined
  const hasText = (v) => typeof v === 'string' && v.trim().length > 0
  const part = e.part
  if (e.type === 'tool_use' && part && typeof part === 'object' && hasText(part.tool)) {
    const input = part.state?.input
    const failed = part.state?.status === 'error' ? ' (실패)' : ''
    if (part.tool === 'bash' && hasText(input?.command)) return '명령 실행: ' + safePreview(input.command) + failed
    if (part.tool === 'todowrite') {
      const todos = input?.todos
      if (!Array.isArray(todos) || !todos.every((t) => t && typeof t.status === 'string')) return undefined
      return `할 일: ${todos.filter((t) => t.status === 'completed').length}/${todos.length} 완료`
    }
    return '도구 호출: ' + safePreview(part.tool) + failed
  }
  if (e.type === 'text' && hasText(part?.text)) return '답변: ' + safePreview(part.text)
  if (e.type === 'error') {
    // 오류 이름·메시지만 — 메시지에 섞일 수 있는 값은 미리보기 규칙으로 가린다.
    const err = e.error
    const name = hasText(err?.name) ? err.name : 'Error'
    const msg = hasText(err?.data?.message) ? err.data.message : hasText(err?.message) ? err.message : ''
    return '오류: ' + safePreview(msg ? `${name} ${msg}` : name)
  }
  return undefined
}

/**
 * 키 보호 플러그인의 훅(guard-plugin.js 가 그대로 낸다) — 판정은 genia 확장·Codex hook 과 같은 toolBlockReason 한곳이다.
 *   shell.env: 셸 도구의 환경에서 토큰 변수를 빈 값으로 덮는다(delete 는 듣지 않는다 — process.env 가 다시 합쳐진다, 11-08 실측).
 *   tool.execute.before: 키 저장소·헤더 스크립트에 닿으면 throw — 그 도구 호출이 오류로 막히고 이유가 모델에 보인다.
 * 같은 사용자의 부모 프로세스 환경(/proc/<ppid>/environ)은 여전히 보인다 — Codex 의 shell_environment_policy.exclude 와 같은 보호 수준이다.
 */
export function guardHooks() {
  return {
    'shell.env': async (_input, output) => {
      if (!output || typeof output !== 'object') return
      output.env ??= {}
      for (const name of HIDDEN_ENV) output.env[name] = ''
    },
    'tool.execute.before': async (input, output) => {
      // cli 를 주면 OpenCode 만의 인자(bash workdir)도 보고, genia 명령(/gw-as)을 안내하지 않는 문구로 막는다(WP-1410).
      const reason = toolBlockReason(String(input?.tool ?? '').toLowerCase(), output?.args, { cli: 'opencode' })
      if (reason) throw new Error(reason)
    },
  }
}
