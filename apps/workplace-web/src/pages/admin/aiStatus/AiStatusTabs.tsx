// 「AI 현황」 개요 ↔ 처리 이력 탭(WP-1825) — 두 화면 머리 아래에 같은 모양으로 놓는다.
// 탭은 주소가 가진다(pathname 이 /history 로 끝나면 처리 이력). 바꿀 때 기간만 가져가고 그 밖의 조건은 화면마다 따로다.
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { periodSearch } from './aiStatusHistoryModel'

const OVERVIEW_PATH = '/settings/ai-status'
const HISTORY_PATH = '/settings/ai-status/history'

/** 개요·처리 이력 탭 — 값은 주소에서 읽고, 바꾸면 이동(push)해서 뒤로 가기로 돌아올 수 있게 한다. */
export function AiStatusTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const value = pathname.endsWith('/history') ? 'history' : 'overview'
  // 기본 24h 와 모르는 값은 주소에 싣지 않는다(두 화면 모두 기본값이라 같은 화면이 열린다)
  const search = periodSearch(params)

  return (
    <Tabs
      value={value}
      onValueChange={(next) => navigate((next === 'history' ? HISTORY_PATH : OVERVIEW_PATH) + search)}
      data-help="ai-status.tabs"
    >
      <TabsList aria-label="AI 현황 화면">
        <TabsTrigger value="overview" data-testid="ai-status-tab-overview">
          개요
        </TabsTrigger>
        <TabsTrigger value="history" data-testid="ai-status-tab-history">
          처리 이력
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
