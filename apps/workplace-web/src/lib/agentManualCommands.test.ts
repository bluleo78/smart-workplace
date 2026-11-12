// 매뉴얼 15장 외부 도구 연결 절의 명령 표류 검사(WP-1507).
// 외부 AI 연결 명령은 화면 가이드에서 매뉴얼 도움말 절(agent.run.keys.connect)로 옮겨 갔다. 도움말 패널은 그 절의 코드 블록을
// 자리표시만 채워 복사하게 하므로, 플러그인 명령 표기(pluginGuide.ts)를 바꾸면 매뉴얼 코드 블록도 같이 바뀌어야 한다.
// 매뉴얼 스크립트(.mjs)에서는 TS 빌더를 불러올 수 없어 웹 테스트가 매뉴얼 원문을 직접 읽어 대조한다.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildLaunchAsCommand,
  buildPluginInstallCommands,
  buildSwitchCommand,
  buildTokenFallbackCommand,
  buildWorkLoopLaunchCommand,
  buildWorkLoopStartCommand,
  PLUGIN_COMMANDS,
} from './pluginGuide'

/** 15장 원문 — 목록 항목 안에 들여 쓴 코드 블록도 대조되게 줄마다 앞 공백을 걷는다. */
const manual = readFileSync(new URL('../../../../docs/manual/user/15-agents.md', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trimStart())
  .join('\n')

describe('agentManualCommands', () => {
  it('매뉴얼 15장 외부 도구 연결 절의 명령이 플러그인 명령 빌더와 같다 (WP-1507)', () => {
    expect(manual).toContain('{help=agent.run.keys.connect label=외부 도구 연결}')
    const expected = [
      buildPluginInstallCommands('{app.origin}'),
      PLUGIN_COMMANDS.login,
      buildSwitchCommand('{agent.username}'),
      buildLaunchAsCommand('{agent.username}'),
      buildWorkLoopLaunchCommand('{agent.username}'),
      buildWorkLoopStartCommand(),
      buildTokenFallbackCommand(),
      '/plugin configure genia-works@genia-works',
      '{app.mcpEndpoint}',
      '{if app.customMcpServer}',
    ]
    for (const command of expected) expect(manual, command).toContain(command)
  })
})
