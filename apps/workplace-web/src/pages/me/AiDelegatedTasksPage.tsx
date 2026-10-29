// AI 위임 작업(WP-377) — AI 가 맡았거나 AI 도구로 진행 중인 이슈를 "내가 답하거나 검토할 것" 먼저 보여 주는 분류 화면.
// 보기는 둘(WP-1201) — 이슈별(기본, aiTasks/AiIssuesView)과 AI별(aiAgents/AiAgentsView). 각 보기가 툴바·칩·목록·AI 화면 컨텍스트를 맡는다.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Page } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { cn } from '@/lib/utils'

import { AiAgentsView } from './aiAgents/AiAgentsView'
import { AiIssuesView } from './aiTasks/AiIssuesView'
import { aiTaskScope } from './aiTasks/aiTaskParams'

export default function AiDelegatedTasksPage() {
  const [params] = useSearchParams()
  const agents = params.get('view') === 'agents'
  // 본문 스크롤 요소 — 무한 로드 sentinel 의 root(DS 05 §A-3). state ref 라 마운트 뒤 observer 가 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  return (
    <Page>
      {/* 모바일은 모듈 레이아웃의 뒤로가기 바(‹ 작업 ✦)가 헤더 — 헤더 바는 데스크톱에서만(내 작업과 동일). */}
      <Page.Header title="AI 위임 작업" mobile="hidden" />
      <Page.Body className="space-y-4" scrollRef={setScrollEl}>
        <h1 className={cn(pageTitleClass, 'lg:hidden')}>AI 위임 작업</h1>
        {agents ? <AiAgentsView scope={aiTaskScope(params)} /> : <AiIssuesView scrollEl={scrollEl} />}
      </Page.Body>
    </Page>
  )
}
