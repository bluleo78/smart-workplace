// 에이전트 화면 「실행 환경」 탭(WP-1281) — 예전 「AI 실행 위치」 화면(WP-1256)을 옮겼다. 실행 환경 = 연결 프로그램을 설치한 클러스터 네임스페이스 하나.
// 표(이름·설명·기본·연결 상태·이 환경의 AI·최대 AI 수) + 「+ 실행 환경 추가」(머리 단추) → 연결 토큰 1회 표시 + 설치 순서 + ⋯ 메뉴(기본 지정·이름/최대 AI 수·토큰 재발급·삭제).
// 화면 위 설명 문단과 설치 문제 해결은 설정 가이드(settingsGuides.agentLocations)로 옮겼다.

import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { IconHint } from '@/components/ui/icon-hint';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { formatRelativeTime } from '@/lib/formatters';

import {
  useAgentLocations,
  useAgentRuntimeSummaries,
  useDeleteAgentLocation,
  useRotateAgentLocationToken,
  useSetDefaultAgentLocation,
} from '../../../hooks/queries/useAgentRuntime';
import {
  connectionPill,
  locationDeleteBlockReason,
  METRICS_INSTALL_HINT,
  metricsUnavailable,
  statusPill,
} from '../../../lib/agentRuntimeStatus';
import type { AgentLocation, AgentLocationTokenResponse, AgentRuntimeSummary } from '../../../types/agentRuntime';
import { AgentLocationFormDialog } from './AgentLocationFormDialog';
import { AgentLocationTokenDialog } from './AgentLocationTokenDialog';

/** AI 열에 이름을 보일 최대 수 — 넘으면 「외 N명」. */
const MAX_AGENT_NAMES = 3;

interface Props {
  /** 머리 「+ 실행 환경 추가」로 여는 창 — 단추는 페이지 머리(AgentManagementPage)에 있다. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

export function AgentLocationsTab({ createOpen, onCreateOpenChange }: Props) {
  const locations = useAgentLocations();
  // AI 열의 상태 글자(작업 중·쉬는 중 등) — 목록 「실행」 열과 같은 요약을 AI id 로 찾는다(실행 환경 응답을 넓히지 않게).
  const summaries = useAgentRuntimeSummaries();
  const summaryById = useMemo(() => new Map(summaries.data?.map((s) => [s.agentUserId, s])), [summaries.data]);
  const setDefault = useSetDefaultAgentLocation();
  const rotate = useRotateAgentLocationToken();
  const remove = useDeleteAgentLocation();
  // 고칠 실행 환경 — null 이면 닫힘. 추가는 머리 단추(createOpen)가 연다.
  const [editing, setEditing] = useState<AgentLocation | null>(null);
  // 발급 직후 한 번만 보이는 토큰 + 처음 만든 실행 환경인지(설치 순서를 보일지).
  const [issued, setIssued] = useState<{ res: AgentLocationTokenResponse; created: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'delete'; location: AgentLocation } | null>(null);

  const rows = locations.data ?? [];

  return (
    <>
      <div className="rounded-md border">
        <Table aria-label="실행 환경 목록">
          <TableHeader>
            <TableRow>
              <TableHead>실행 환경</TableHead>
              {/* 좁은 화면은 연결·AI·최대 AI 수 열을 숨기고 이름 아래 줄로 모은다(에이전트 목록과 같은 방식). */}
              <TableHead className="hidden md:table-cell">연결</TableHead>
              <TableHead className="hidden md:table-cell">AI</TableHead>
              <TableHead className="hidden text-right md:table-cell">최대 AI 수</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.isLoading ? (
              <TableSkeletonRows columns={5} rows={3} />
            ) : rows.length === 0 ? (
              <TableEmptyRow colSpan={5} message="아직 실행 환경이 없어요. 「+ 실행 환경 추가」로 만드세요." />
            ) : (
              rows.map((l) => {
                const pill = connectionPill(l.connection);
                const deleteBlocked = locationDeleteBlockReason(l);
                const reported = l.lastSeenAt ? `${formatRelativeTime(l.lastSeenAt)} 보고` : null;
                return (
                  <TableRow key={l.id} data-testid={`agent-location-row-${l.id}`} className="align-top">
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.name}</span>
                        {l.isDefault && <Badge variant="secondary">기본</Badge>}
                      </div>
                      {l.description && <p className="mt-0.5 text-xs text-muted-foreground">{l.description}</p>}
                      {/* 모바일 전용 — 숨긴 연결·최대 AI 수·AI 열의 값 */}
                      <div className="mt-1.5 space-y-1 md:hidden" data-testid={`agent-location-meta-${l.id}`}>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <StatusBadge type={pill.type}>{pill.label}</StatusBadge>
                          <span>
                            {reported ? `${reported} · ` : ''}AI {l.used} / {l.capacity}
                          </span>
                          {metricsUnavailable(l) && <MetricsUnavailableNote testId={`agent-location-metrics-unavailable-m-${l.id}`} />}
                        </div>
                        {l.agents.length > 0 && <LocationAgents agents={l.agents} summaryById={summaryById} compact />}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          <StatusBadge type={pill.type} data-testid={`agent-location-connection-${l.id}`}>
                            {pill.label}
                          </StatusBadge>
                          {metricsUnavailable(l) && <MetricsUnavailableNote testId={`agent-location-metrics-unavailable-${l.id}`} />}
                        </div>
                        {reported && <span className="text-xs text-muted-foreground">{reported}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell" data-testid={`agent-location-agents-${l.id}`}>
                      {l.agents.length > 0 ? (
                        <LocationAgents agents={l.agents} summaryById={summaryById} />
                      ) : (
                        <span className="text-xs text-muted-foreground">아직 이 실행 환경을 쓰는 AI 가 없어요</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right md:table-cell" data-testid={`agent-location-seats-${l.id}`}>
                      <span className="tabular-nums">
                        {l.used} / {l.capacity}
                      </span>
                      <p className="text-xs text-muted-foreground">실행 중 / 최대</p>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${l.name} 메뉴`} data-testid={`agent-location-menu-${l.id}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-w-72">
                          {!l.isDefault && <DropdownMenuItem onSelect={() => setDefault.mutate(l.id)}>기본으로 지정</DropdownMenuItem>}
                          <DropdownMenuItem onSelect={() => setEditing(l)}>이름·최대 AI 수 바꾸기</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConfirm({ kind: 'rotate', location: l })}>토큰 재발급</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {/* 삭제 막힘은 서버 거절 조건과 같다(기본이거나 이 환경을 고른 실행 설정이 있음) — 막힌 이유를 항목 안에 보인다. */}
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={deleteBlocked != null}
                            onSelect={() => setConfirm({ kind: 'delete', location: l })}
                            data-testid={`agent-location-delete-${l.id}`}
                          >
                            <span className="flex flex-col">
                              <span>삭제</span>
                              {deleteBlocked && <span className="text-xs text-muted-foreground">{deleteBlocked}</span>}
                            </span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {(createOpen || editing != null) && (
        <AgentLocationFormDialog
          location={editing}
          onClose={() => {
            setEditing(null);
            onCreateOpenChange(false);
          }}
          onCreated={(res) => setIssued({ res, created: true })}
        />
      )}

      <AgentLocationTokenDialog
        // 실행 환경마다 새로 그린다 — 앞 환경에 넣은 내부 IP 가 다음 환경의 설치 명령에 남지 않게.
        key={issued?.res.location.id ?? 'closed'}
        issued={issued?.res ?? null}
        showInstall={issued?.created ?? false}
        onClose={() => setIssued(null)}
      />

      <DeleteConfirmDialog
        open={confirm?.kind === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        entityName="실행 환경"
        itemName={confirm?.location.name ?? ''}
        description={`「${confirm?.location.name ?? ''}」 실행 환경을 삭제해요. 설치한 연결 프로그램은 더 이상 연결되지 않으니 클러스터에서 helm uninstall 로 지우세요.`}
        onConfirm={() => confirm && remove.mutate(confirm.location.id, { onSuccess: () => setConfirm(null) })}
      />
      <AlertDialog open={confirm?.kind === 'rotate'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>토큰 재발급</AlertDialogTitle>
            <AlertDialogDescription>
              「{confirm?.location.name}」의 연결 토큰을 새로 만들어요. 지금 설치된 연결 프로그램은 바로 끊기니 새 토큰으로 바꿔
              주세요. 그동안 돌던 AI 는 그대로 돌아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm &&
                rotate.mutate(confirm.location.id, {
                  onSuccess: (res) => {
                    setConfirm(null);
                    setIssued({ res, created: false });
                  },
                })
              }
            >
              재발급
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 이 실행 환경의 AI — 이름(상세로 가는 링크) · 지금 상태. 셋이 넘으면 「외 N명」.
 * compact(모바일)는 상태 없이 이름만 가운뎃점으로 잇는다.
 */
function LocationAgents({
  agents,
  summaryById,
  compact = false,
}: {
  agents: AgentLocation['agents'];
  summaryById: Map<number, AgentRuntimeSummary>;
  compact?: boolean;
}) {
  const shown = agents.slice(0, MAX_AGENT_NAMES);
  const rest = agents.length - shown.length;
  const restText = rest > 0 ? `외 ${rest}명` : null;
  if (compact) {
    return (
      <p className="text-xs text-muted-foreground">
        {shown.map((a, i) => (
          <span key={a.id}>
            {i > 0 && ' · '}
            <Link to={`/settings/agents/${a.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {a.name}
            </Link>
          </span>
        ))}
        {restText && ` ${restText}`}
      </p>
    );
  }
  return (
    <ul className="space-y-0.5 text-sm">
      {shown.map((a) => {
        const s = summaryById.get(a.id);
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-x-1.5">
            <Link to={`/settings/agents/${a.id}`} className="text-primary hover:underline">
              {a.name}
            </Link>
            {s && <span className="text-xs text-muted-foreground">· {statusPill(s.status, s.agentState).label}</span>}
          </li>
        );
      })}
      {restText && <li className="text-xs text-muted-foreground">{restText}</li>}
    </ul>
  );
}

/**
 * 사용량을 잴 수 없는 실행 환경 표시(WP-1280) — 연결 배지 옆 흐린 글씨. 마우스는 hover·포커스 툴팁, 터치는 탭 팝오버({@link IconHint})로
 * 이유와 metrics-server 설치 안내를 보인다. 글씨만으로도 뜻이 통해 안내를 못 봐도 잃는 정보가 없다.
 */
function MetricsUnavailableNote({ testId }: { testId: string }) {
  return (
    <IconHint label={METRICS_INSTALL_HINT} data-testid={testId}>
      <span className="cursor-default text-xs text-muted-foreground">사용량 측정 안 됨</span>
    </IconHint>
  );
}
