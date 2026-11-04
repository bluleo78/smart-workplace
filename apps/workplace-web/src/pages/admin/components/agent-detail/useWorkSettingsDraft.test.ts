// @vitest-environment jsdom
// 「작업 설정」 초안(WP-1344) — 비워 저장한 선택 칸(queue "")이 초안에서도 빈 값이고 변경으로 잡히지 않는지 고정한다.
import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'

import { CLAUDE_TEMPLATE, createSetting } from '../../../../test/kits/admin/agentRuntime'
import { useWorkSettingsDraft } from './useWorkSettingsDraft'

test('저장된 queue 가 빈 문자열이면 초안 칸도 비어 있고 dirty 가 아니다', () => {
  const saved = createSetting(1, { config: { model: 'opus', queue: '' } })
  const { result } = renderHook(() => useWorkSettingsDraft(CLAUDE_TEMPLATE, saved))

  expect(result.current?.config.queue).toBe('')
  expect(result.current?.dirty).toBe(false)
  // 저장 요청도 빈 값을 그대로 보낸다(기본값으로 채워 보내지 않는다).
  expect(result.current?.body().config).toEqual({ model: 'opus', queue: '' })
})

test('저장 전(saved null) 초안은 기본값 AI 개발팀이다', () => {
  const { result } = renderHook(() => useWorkSettingsDraft(CLAUDE_TEMPLATE, null))

  expect(result.current?.config.queue).toBe('AI 개발팀')
  expect(result.current?.dirty).toBe(true)
})
