// 화면이 주는 도움말 자리표시 값 등록·읽기(WP-1505) — 마운트 동안만 등록되고, 나중 등록이 이기며, 앱 기본값이 깔린다.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MCP_ENDPOINT } from '@/lib/mcpEndpoint'
import { needsServerUrlSetting } from '@/lib/pluginGuide'

import { useHelpValues, useProvideHelpValues } from './helpValues'

/** 값을 등록하는 화면 대역. */
function Provider({ username }: { username: string | undefined }) {
  useProvideHelpValues({ placeholders: { 'agent.username': username } })
  return null
}

/** 지금 값을 글로 보이는 탐침. */
function Probe() {
  const v = useHelpValues()
  return (
    <dl>
      <dd data-testid="username">{v.placeholders['agent.username'] ?? '(없음)'}</dd>
      <dd data-testid="origin">{v.placeholders['app.origin']}</dd>
      <dd data-testid="mcp">{v.placeholders['app.mcpEndpoint']}</dd>
      <dd data-testid="custom">{String(v.conditions['app.customMcpServer'])}</dd>
    </dl>
  )
}

describe('helpValues', () => {
  it('등록 화면이 마운트되면 그 값, 언마운트되면 없음', () => {
    const view = render(
      <>
        <Provider username="dev5" />
        <Probe />
      </>,
    )
    expect(screen.getByTestId('username')).toHaveTextContent('dev5')
    view.rerender(
      <>
        <Provider username="dev6" />
        <Probe />
      </>,
    )
    expect(screen.getByTestId('username')).toHaveTextContent('dev6')
    view.rerender(<Probe />)
    expect(screen.getByTestId('username')).toHaveTextContent('(없음)')
  })

  it('여러 화면이 등록하면 나중에 마운트한 것이 이긴다', () => {
    render(
      <>
        <Provider username="먼저" />
        <Provider username="나중" />
        <Probe />
      </>,
    )
    expect(screen.getByTestId('username')).toHaveTextContent('나중')
  })

  it('앱 기본값 — 앱 주소·MCP 주소·기본 주소가 아닌 서버인지', () => {
    render(<Probe />)
    expect(screen.getByTestId('origin')).toHaveTextContent(window.location.origin)
    expect(screen.getByTestId('mcp')).toHaveTextContent(MCP_ENDPOINT)
    expect(screen.getByTestId('custom')).toHaveTextContent(String(needsServerUrlSetting(MCP_ENDPOINT)))
  })
})
