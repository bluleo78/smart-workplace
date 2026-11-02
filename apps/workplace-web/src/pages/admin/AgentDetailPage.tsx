// ADMIN — 에이전트 상세 페이지(WP-1281) /settings/agents/:id. 예전 목록 오른쪽 시트를 설정 폼 페이지로 옮겼다.
// 섹션 순서: 상태 → 기본 정보 → 역할 할당 → 맡은 일과 지시 → 실행 → 코드 저장소 → 위험 구역.
// 실행 방식은 서버가 판정한 runMode(WP-1273)로 고른다. Works 가 실행하는 AI 의 작업 설정 초안은 상태(저장하고 실행 시작)와 실행(작업 설정)이
// 함께 보므로 여기서 한 번 만들어 내려준다.

import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { SettingsPage } from '@/components/layout/SettingsPage';
import { LoadErrorState } from '@/components/LoadErrorState';
import { agentDetailGuide, settingsGuides } from '@/components/settings-guide/settingsGuides';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentBadge } from '@/components/users/AgentBadge';
import { isNotFoundError } from '@/lib/api-error';
import { parseId } from '@/lib/historyParam';

import { useAgentRuntimeSetting, useAgentTemplates } from '../../hooks/queries/useAgentRuntime';
import { useAgent } from '../../hooks/queries/useAgents';
import { runModeCards } from '../../lib/agentRunMode';
import type { AgentResponse } from '../../types/agent';
import {
  AgentBasicInfoSection,
  AgentDangerSection,
  AgentDutySection,
  AgentRepoSection,
  AgentRolesSection,
} from './components/agent-detail/AgentProfileSections';
import { AgentRunSection } from './components/agent-detail/AgentRunSection';
import { AgentStatusSection, type WorksRun } from './components/agent-detail/AgentStatusSection';
import { useWorkSettingsDraft } from './components/agent-detail/useWorkSettingsDraft';

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = parseId(params.id ?? null);
  const agent = useAgent(id);

  // 뒤로가기 단추 — 제목 왼쪽에 두는 관례(#102, UserDetailPage 와 같다). 모바일은 상세 헤더의 ‹ 가 대신한다.
  const backButton = (
    <Button variant="ghost" size="icon" onClick={() => navigate('/settings/agents')} aria-label="목록으로 돌아가기" title="목록으로 돌아가기">
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );

  if (agent.isLoading) {
    return (
      <SettingsPage title="에이전트 상세" icon={backButton} width="form" guide={settingsGuides.agentDetail}>
        <div className="space-y-4 py-6">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </SettingsPage>
    );
  }
  if (agent.isError && !isNotFoundError(agent.error)) {
    // 일시적인 실패(네트워크·5xx) — 지워졌다고 말하지 않고 다시 시도할 수 있게 한다.
    return (
      <SettingsPage title="에이전트 상세" icon={backButton} width="form">
        <LoadErrorState title="에이전트를 불러오지 못했습니다" queries={[agent]} testId="agent-detail-error" />
      </SettingsPage>
    );
  }
  if (!agent.data) {
    // 잘못된 주소·지워진 AI — 주소를 조용히 고치지 않고 안내한다.
    return (
      <SettingsPage title="에이전트 상세" icon={backButton} width="form">
        <p className="py-6 text-sm text-muted-foreground" data-testid="agent-detail-notfound">
          에이전트를 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.
        </p>
      </SettingsPage>
    );
  }
  // key — 다른 AI 로 바뀌면(목록 → 다른 상세) 섹션의 입력 초안을 새로 채운다.
  return <AgentDetail key={agent.data.id} agent={agent.data} backButton={backButton} />;
}

function AgentDetail({ agent, backButton }: { agent: AgentResponse; backButton: React.ReactNode }) {
  const templates = useAgentTemplates();
  const worksMode = agent.runMode === 'WORKSPACE';
  const setting = useAgentRuntimeSetting(agent.id, worksMode);
  const saved = worksMode ? (setting.data ?? null) : null;
  const template = templates.data?.find((t) => t.name === saved?.templateName) ?? null;
  const draft = useWorkSettingsDraft(template, saved);
  const worksRun: WorksRun | null = template ? { template, saved, draft } : null;
  // 머리 배지 — 지금 실행 방식(기본·Claude Code 등·외부).
  const modeTitle =
    agent.runMode === 'WORKSPACE' ? (template?.card.title ?? null) : runModeCards(templates.data).find((c) => c.id === agent.runMode)?.title;
  const personal = agent.type === 'PERSONAL';

  return (
    <SettingsPage
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{agent.name}</span>
          <AgentBadge size="xs" />
        </span>
      }
      meta={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          @{agent.username}
          {modeTitle && <Badge variant="secondary">{modeTitle}</Badge>}
          {!agent.isActive && <Badge variant="outline">사용 중지</Badge>}
        </span>
      }
      icon={backButton}
      width="form"
      // 실행 방식에 맞춘 가이드 — 화면에서 뺀 설명(계정 조건·자원·키 교체·연결 방법 해설)이 여기 있다.
      guide={agentDetailGuide(agent, template)}
      data-testid="agent-detail-page"
      // WP-414: AI 화면 맥락 — 저장된 값만(이름·아이디·실행 방식·사용 여부).
      aiContext={{
        focus: {
          type: '에이전트',
          label: agent.name,
          refs: { username: agent.username },
          facts: [
            ['아이디', agent.username],
            ['실행 방식', modeTitle ?? '-'],
            ['사용', agent.isActive ? '사용 중' : '사용 중지'],
          ],
        },
      }}
    >
      <AgentStatusSection agent={agent} worksRun={worksRun} />
      <AgentBasicInfoSection agent={agent} />
      {!personal && <AgentRolesSection agent={agent} />}
      <AgentDutySection agent={agent} />
      <AgentRunSection agent={agent} templates={templates.data} worksRun={worksRun} savedTemplateName={saved?.templateName ?? null} />
      {agent.runMode !== 'SERVER' && !personal && <AgentRepoSection agent={agent} />}
      {!personal && <AgentDangerSection agent={agent} />}
    </SettingsPage>
  );
}
