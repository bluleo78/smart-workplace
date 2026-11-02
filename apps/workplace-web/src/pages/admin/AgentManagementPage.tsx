// ADMIN — 「에이전트」 화면(WP-1281). 한 화면에 탭 [목록 | 실행 환경].
// 주소가 곧 탭이다 — /settings/agents = 목록, /settings/agents/locations = 실행 환경(옛 /settings/agent-locations 는 라우트가 이리로 넘긴다).
// 머리 주 단추와 설정 가이드는 탭을 따라 바뀐다. 에이전트 상세는 시트가 아니라 별도 페이지(/settings/agents/:id, AgentDetailPage).

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { SettingsPage } from '@/components/layout/SettingsPage';
import { settingsGuides } from '@/components/settings-guide/settingsGuides';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseId } from '@/lib/historyParam';

import { AgentListTab } from './components/AgentListTab';
import { AgentLocationsTab } from './components/AgentLocationsTab';

type AgentTab = 'list' | 'locations';

/** 탭별 주소(탭을 바꾸면 이 주소로 이동 — 뒤로 가기로 앞 탭에 돌아온다)와 머리 주 단추. */
const TABS: Record<AgentTab, { path: string; createLabel: string; createTestId: string }> = {
  list: { path: '/settings/agents', createLabel: '+ 새 에이전트', createTestId: 'new-agent-trigger' },
  locations: { path: '/settings/agents/locations', createLabel: '+ 실행 환경 추가', createTestId: 'agent-location-new' },
};

export default function AgentManagementPage() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const tab: AgentTab = pathname.replace(/\/$/, '').endsWith('/locations') ? 'locations' : 'list';
  // 머리 「+ 새 에이전트」·「+ 실행 환경 추가」가 여는 창 — 창 자체는 각 탭이 그린다. 탭을 바꾸면 닫는다(onValueChange).
  const [createOpen, setCreateOpen] = useState(false);
  // 옛 상세 딥링크(?agent=<id>, 시트 시절 WP-209)는 상세 페이지로 넘긴다 — 알림·문서에 남은 링크가 계속 열리게.
  const legacyAgentId = parseId(new URLSearchParams(search).get('agent'));
  if (legacyAgentId != null) return <Navigate to={`/settings/agents/${legacyAgentId}`} replace />;

  return (
    <SettingsPage
      title="에이전트"
      guide={tab === 'list' ? settingsGuides.agents : settingsGuides.agentLocations}
      actions={
        /* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). */
        <Button onClick={() => setCreateOpen(true)} data-testid={TABS[tab].createTestId}>
          {TABS[tab].createLabel}
        </Button>
      }
    >
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setCreateOpen(false);
          navigate(TABS[v as AgentTab].path);
        }}
      >
        <TabsList aria-label="에이전트 화면">
          <TabsTrigger value="list" data-testid="agent-tab-list">
            목록
          </TabsTrigger>
          <TabsTrigger value="locations" data-testid="agent-tab-locations">
            실행 환경
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'list' ? (
        <AgentListTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      ) : (
        <AgentLocationsTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      )}
    </SettingsPage>
  );
}
