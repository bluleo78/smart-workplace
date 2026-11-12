// AI 화면 참고 탐침(WP-1507, 테스트 전용) — 지금 등록된 화면 참고(useAiScreenContext)를 JSON 글로 그린다.
// 화면 테스트가 AI 패널을 띄우지 않고도 「무엇이 AI 에게 실리는지」를 단언하게 한다. AiScreenContextProvider 안에 둔다.
import { screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { useAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { withAppProviders } from '@/test/kits/appProviders'
import type { AiScreenContext } from '@/types/aiScreenContext'

import { OpenAiPanel } from './OpenPanels'

/** 등록된 화면 참고를 `<pre data-testid="screen-context-probe">` 에 JSON 으로 보인다(없으면 `null`). */
export function ScreenContextProbe() {
  const ctx = useAiScreenContext()
  return <pre data-testid="screen-context-probe">{JSON.stringify(ctx)}</pre>
}

/** 화면에 그려진 탐침 글을 지금 화면 참고로 되돌린다(탐침이 없으면 던진다). */
export function currentScreenContext(): AiScreenContext | null {
  return JSON.parse(screen.getByTestId('screen-context-probe').textContent ?? 'null') as AiScreenContext | null
}

/**
 * 화면을 앱 상태 Provider(withAppProviders)로 감싸고 AI 옆 패널을 연 채 탐침을 붙인다.
 * 설정 화면 AI 참고 요약은 AI 패널이 열려 있을 때만 매뉴얼을 받으므로(useManualSummary) 연 상태로 띄운다 — 묶음 핸들러(helpBundleHandlers)는 테스트가 준다.
 */
export function withScreenContextProbe(ui: ReactElement) {
  return withAppProviders(
    <>
      <OpenAiPanel />
      {ui}
      <ScreenContextProbe />
    </>,
  )
}
