// 도움말 패널 본체를 열 때 불러온다(WP-1505, AI 표면의 LazyAiSurfaces·WP-970 과 같은 이유).
// HelpPanel 은 절 본문을 그리는 react-markdown·remark-gfm 을 끌고 오므로, 셸(RightDock·MobileHelpSheet)이 정적으로 가져오면
// 도움말을 한 번도 열지 않는 화면의 첫 부팅까지 그 모듈을 받아 해석한다. 셸에는 상태(HelpPanelProvider)·「?」 단추·배치 판정만 둔다.
import { lazy, Suspense } from 'react'

import type { HelpPanelProps } from './HelpPanel'
import { preloadHelpPanel } from './helpPanelLoader'
import { HelpSkeleton } from './HelpSkeleton'

const HelpPanel = lazy(() => preloadHelpPanel().then((m) => ({ default: m.HelpPanel })))

/** 도움말 패널 — 본체를 받는 동안은 받는 중 스켈레톤을 보인다(패널 틀·폭은 그리는 쪽 몫이라 자리가 흔들리지 않는다). */
export function LazyHelpPanel(props: HelpPanelProps) {
  return (
    <Suspense fallback={<HelpSkeleton />}>
      <HelpPanel {...props} />
    </Suspense>
  )
}
