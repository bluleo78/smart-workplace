// ADMIN — 「에이전트」 화면(WP-1281). 한 화면에 탭 [목록 | 실행 환경 | 계정(WP-1451)].
// 주소가 곧 탭이다 — /settings/agents = 목록, /settings/agents/locations = 실행 환경(옛 /settings/agent-locations 는 라우트가 이리로 넘긴다),
// /settings/agents/accounts = AI 계정 목록.
// 머리 주 단추와 AI 화면 참고(매뉴얼 15장의 탭 대표 도움말 절 요약)는 탭을 따라 바뀐다. 에이전트 상세는 시트가 아니라 별도 페이지(/settings/agents/:id, AgentDetailPage).
// 도움말 문맥(WP-1507): 탭·칸·대화상자에 data-help 를 달아 도움말 패널이 15장의 맞는 절(agents 층)을 저절로 보이게 한다.
// 값은 글자 그대로 둔다 — 매뉴얼 정적 검사(manual:check, docs/manual/scripts/lib/help-screen.mjs)는 속성에 따옴표 글자로 적은 값만
// 짝 검사하고, 객체·변수로 넘긴 값은 「동적」 으로 세기만 한다. 머리 단추를 TABS 표로 한 번만 그리면 agents.locations.create·
// agents.accounts.add 는 다른 곳에 글자 꼴이 없어(대화상자는 조건식) 짝 검사에서 빠진다 — 그래서 머리 단추는 탭별 JSX 로 나눠 둔다.

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { SettingsPage } from '@/components/layout/SettingsPage';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseId } from '@/lib/historyParam';

import { AgentAccountsTab } from './components/AgentAccountsTab';
import { AgentListTab } from './components/AgentListTab';
import { AgentLocationsTab } from './components/AgentLocationsTab';

type AgentTab = 'list' | 'locations' | 'accounts';

/**
 * 탭별 주소(탭을 바꾸면 이 주소로 이동 — 뒤로 가기로 앞 탭에 돌아온다)와 AI 화면 참고(help: 탭 대표 도움말 id·화면 이름).
 * 화면 이름은 옛 설정 가이드 제목(「설정 · 에이전트」 등)과 같게 둬 AI 칩 문구가 바뀌지 않게 한다.
 */
const TABS: Record<AgentTab, { path: string; help: { id: string; name: string } }> = {
  list: { path: '/settings/agents', help: { id: 'agents.list', name: '에이전트' } },
  locations: { path: '/settings/agents/locations', help: { id: 'agents.locations', name: '실행 환경' } },
  accounts: { path: '/settings/agents/accounts', help: { id: 'agents.accounts', name: '계정' } },
};

/** 주소 → 탭. 정적 경로(/locations·/accounts)만 보고, 나머지는 목록이다. */
function tabOf(pathname: string): AgentTab {
  const path = pathname.replace(/\/$/, '');
  if (path.endsWith('/locations')) return 'locations';
  if (path.endsWith('/accounts')) return 'accounts';
  return 'list';
}

export default function AgentManagementPage() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const tab = tabOf(pathname);
  // 머리 「+ 새 에이전트」·「+ 실행 환경 추가」가 여는 창 — 창 자체는 각 탭이 그린다. 탭을 바꾸면 닫는다(onValueChange).
  const [createOpen, setCreateOpen] = useState(false);
  // 옛 상세 딥링크(?agent=<id>, 시트 시절 WP-209)는 상세 페이지로 넘긴다 — 알림·문서에 남은 링크가 계속 열리게.
  const legacyAgentId = parseId(new URLSearchParams(search).get('agent'));
  if (legacyAgentId != null) return <Navigate to={`/settings/agents/${legacyAgentId}`} replace />;

  return (
    <SettingsPage
      title="에이전트"
      help={TABS[tab].help}
      actions={
        /* 헤더 주 액션 — size 미지정(default). 04-components §E 규정(#744/#747). 탭마다 다른 도움말 절로 잇는다(글자 data-help — 파일 머리 주석). */
        tab === 'list' ? (
          <Button onClick={() => setCreateOpen(true)} data-testid="new-agent-trigger" data-help="agents.list.create">
            + 새 에이전트
          </Button>
        ) : tab === 'locations' ? (
          <Button onClick={() => setCreateOpen(true)} data-testid="agent-location-new" data-help="agents.locations.create">
            + 실행 환경 추가
          </Button>
        ) : (
          <Button onClick={() => setCreateOpen(true)} data-testid="agent-account-new" data-help="agents.accounts.add">
            + 계정 추가
          </Button>
        )
      }
    >
      <Tabs
        data-help="agents"
        value={tab}
        onValueChange={(v) => {
          setCreateOpen(false);
          navigate(TABS[v as AgentTab].path);
        }}
      >
        <TabsList aria-label="에이전트 화면">
          <TabsTrigger value="list" data-testid="agent-tab-list" data-help="agents.list">
            목록
          </TabsTrigger>
          <TabsTrigger value="locations" data-testid="agent-tab-locations" data-help="agents.locations">
            실행 환경
          </TabsTrigger>
          <TabsTrigger value="accounts" data-testid="agent-tab-accounts" data-help="agents.accounts">
            계정
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'list' ? (
        <AgentListTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      ) : tab === 'locations' ? (
        <AgentLocationsTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      ) : (
        <AgentAccountsTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      )}
    </SettingsPage>
  );
}
