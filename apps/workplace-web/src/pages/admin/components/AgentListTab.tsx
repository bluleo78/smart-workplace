// 에이전트 화면 「목록」 탭(WP-1281) — 표에서 행을 누르면 상세 페이지(/settings/agents/:id)로 간다(예전 오른쪽 시트는 없앴다).
// 화면에는 목록과 지금 해야 할 일(에이전트 추가·공통 비서 지정 배너)만 두고, 왜·주의는 설정 가이드(settingsGuides.agents)로 옮겼다.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateOnly } from '@/lib/formatters';
import { HIT_AREA_COARSE_TIGHT } from '@/lib/hitArea';

import { AvatarPicture } from '../../../components/users/AvatarPicture';
import { useAgentRuntimeSummaries } from '../../../hooks/queries/useAgentRuntime';
import { useAgents } from '../../../hooks/queries/useAgents';
import { useWorkspaceAssistant } from '../../../hooks/queries/useAssistant';
import { clickableRowProps } from '../../../lib/clickableRowProps';
import type { AgentResponse } from '../../../types/agent';
import { AgentRuntimeCell, AgentRuntimeMetaBadge } from './AgentRuntimeCell';
import { NewAgentDialog } from './NewAgentDialog';

interface Props {
  /** 머리 「+ 새 에이전트」로 여는 창 — 단추는 페이지 머리(AgentManagementPage)에 있다. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

export function AgentListTab({ createOpen, onCreateOpenChange }: Props) {
  const navigate = useNavigate();
  // 개인 비서(자동 생성 AGENT) 포함 여부 토글. 기본 숨김 — 켜면 개인 비서까지 보인다.
  // 개인 비서는 주인이 관리하므로 관리자 목록에서는 숨기는 것이 기본이다(WP-1361 — WP-1281 의 기본 표시를 되돌림).
  const [includePersonal, setIncludePersonal] = useState(false);
  const agents = useAgents(includePersonal);
  // Works 가 실행하는 AI 의 실행 요약(WP-1255) — 목록 「실행」 열의 상태 알약·처리 중 이슈.
  const summaries = useAgentRuntimeSummaries();
  // 행마다 찾지 않게 한 번 표로 — 표·모바일 두 배치가 같은 렌더에서 함께 부른다.
  const summaryById = useMemo(() => new Map(summaries.data?.map((s) => [s.agentUserId, s])), [summaries.data]);
  const summaryOf = (id: number) => summaryById.get(id) ?? null;
  // 공통 비서 상태 — 표 배지 + 빈 상태 배너.
  const ws = useWorkspaceAssistant();
  const isEmpty = !agents.isLoading && !agents.isError && (agents.data ?? []).length === 0;

  return (
    <>
      {/* 지금 해야 할 일 배너 — ① 에이전트가 없으면 추가부터 ② 있는데 공통 비서가 없으면 지정. 이유(공통 비서가 없으면…)는 가이드로 옮겼다. */}
      {isEmpty ? (
        <div
          data-testid="agent-roster-empty"
          className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          아직 에이전트가 없어요. 「+ 새 에이전트」로 추가한 뒤 공통 비서로 지정하세요.
        </div>
      ) : ws.data && ws.data.agentUserId == null ? (
        <div
          data-testid="workspace-assistant-empty"
          className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          아직 공통 비서가 없어요. AI 계정이 연결된 에이전트를 골라 공통 비서로 지정하세요.
        </div>
      ) : null}

      {/* 개인 비서 표시 토글 — 켜면 구성원이 만든 개인 비서까지 목록에 보인다. */}
      <div className="flex items-center justify-end gap-2">
        <Switch
          id="include-personal"
          checked={includePersonal}
          onCheckedChange={setIncludePersonal}
          // 32×18 스위치 — 터치에서는 눌림 영역을 넓힌다(WP-734).
          className={HIT_AREA_COARSE_TIGHT}
          data-testid="include-personal-toggle"
        />
        <Label htmlFor="include-personal" className="text-sm text-muted-foreground">
          개인 비서 표시
        </Label>
      </div>

      <div className="rounded-md border">
        <Table aria-label="에이전트 목록">
          <TableHeader>
            <TableRow>
              <TableHead>에이전트</TableHead>
              {/* 좁은 화면은 나머지 열을 숨기고 이름 아래 한 줄로 모은다 — 표가 휴대폰 폭을 넘었다(WP-639) */}
              <TableHead className="hidden md:table-cell">아이디</TableHead>
              <TableHead className="hidden md:table-cell">유형</TableHead>
              <TableHead className="hidden md:table-cell">실행</TableHead>
              <TableHead className="hidden md:table-cell">생성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  로딩 중…
                </TableCell>
              </TableRow>
            ) : agents.isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-destructive">
                  목록을 불러오지 못했습니다
                </TableCell>
              </TableRow>
            ) : isEmpty ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground" data-testid="agent-list-empty">
                  에이전트가 없습니다
                  {/* 기본으로 숨긴 개인 비서가 있을 수 있으니 켜는 곳을 알려 준다(WP-1361). */}
                  {!includePersonal && (
                    <span className="mt-1 block text-xs">개인 비서는 「개인 비서 표시」를 켜면 보여요.</span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              (agents.data ?? []).map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`agent-row-${a.id}`}
                  {...clickableRowProps(() => navigate(`/settings/agents/${a.id}`), `${a.name} 상세 보기`)}
                >
                  <TableCell>
                    <div className="flex items-start gap-2.5 md:items-center">
                      {/* 아바타 — 올린 이미지(WP-1222) 또는 이름 첫 글자. AGENT 정체성 색(ai-accent)·둥근 네모. */}
                      <span
                        className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ai-accent-subtle text-xs font-semibold text-ai-accent"
                        aria-hidden
                        data-testid={`agent-avatar-${a.id}`}
                      >
                        <AvatarPicture userId={a.id} name={a.name} px={28} className="rounded-md">
                          {a.name.slice(0, 1)}
                        </AvatarPicture>
                      </span>
                      <div className="min-w-0">
                        <span className="font-medium break-words whitespace-normal md:whitespace-nowrap">{a.name}</span>
                        {/* 사용 중지된 AI(삭제 때 기록이 남아 정지된 경우 포함, WP-705) — 상세의 「사용」으로 다시 쓸 수 있다. */}
                        {!a.isActive && (
                          <Badge variant="secondary" className="ml-2 align-middle" data-testid={`agent-inactive-${a.id}`}>
                            사용 중지
                          </Badge>
                        )}
                        {/* 모바일 전용 — 숨긴 아이디·유형·실행 열의 값(WP-639) */}
                        <div
                          className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground md:hidden"
                          data-testid={`agent-meta-${a.id}`}
                        >
                          <span className="max-w-[60vw] truncate">{a.username}</span>
                          <AgentTypeBadge agent={a} />
                          <AgentRuntimeMetaBadge agent={a} summary={summaryOf(a.id)} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{a.username}</TableCell>
                  <TableCell className="hidden md:table-cell" data-testid={`agent-type-${a.id}`}>
                    <AgentTypeBadge agent={a} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell" data-testid={`agent-runtime-cell-${a.id}`}>
                    <AgentRuntimeCell agent={a} summary={summaryOf(a.id)} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {formatDateOnly(a.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <NewAgentDialog open={createOpen} onOpenChange={onCreateOpenChange} />
    </>
  );
}

/** 에이전트 유형 배지 — 표의 유형 열과 모바일 이름 아래 줄이 같이 쓴다. */
export function AgentTypeBadge({ agent }: { agent: AgentResponse }) {
  if (agent.type === 'WORKSPACE') {
    // 공통 비서 = 이 화면의 초점이므로 채워진 primary 배지로 강조.
    return <Badge variant="default">공통</Badge>;
  }
  if (agent.type === 'PERSONAL') {
    // 개인 비서 = secondary 배지 + 소유자 이름(누구의 비서인지). 줄바꿈 방지.
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Badge variant="secondary">개인</Badge>
        <span className="text-xs text-muted-foreground">{agent.ownerName ?? '소유자 미상'}</span>
      </span>
    );
  }
  // 일반 에이전트 = 가장 낮은 강조의 outline 배지.
  return <Badge variant="outline">일반</Badge>;
}
