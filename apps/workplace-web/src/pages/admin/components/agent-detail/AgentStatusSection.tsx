// 에이전트 상세 「상태」 섹션(WP-1281) — 이 AI 를 쓸 수 있는지(「사용」 스위치)와 지금 무엇을 하는지.
// 말 구분: 워크스페이스에서 쓸 수 있는지는 「사용 / 사용 중지」, Works 가 띄운 AI 를 돌리는 것은 「실행 시작 / 실행 멈춤 / 다시 시작」.
// Works 가 실행하는 AI 는 「실행」 묶음(상태 알약·이슈·경과·실행 환경·CPU/메모리·쉴 때 적용·실행 전 확인), 외부 AI 는 마지막 접속만 보인다.

import { Check, Info, MonitorPlay, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection';
import { AGENT_DETAIL_SECTION_IDS } from '@/components/settings-guide/settingsGuides';
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
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';

import { usersApi } from '../../../../api/users';
import { useAgentProviderCredentialMeta } from '../../../../hooks/queries/useAgentProviderCredential';
import {
  useAgentLocations,
  useAgentRepoCredentials,
  useAgentRuntimeAction,
  useAgentRuntimeProjects,
  useInvalidateRuntime,
  useSaveAgentRuntimeSetting,
} from '../../../../hooks/queries/useAgentRuntime';
import { startBlockReason } from '../../../../lib/agentRunMode';
import { externalKeyStatusText } from '../../../../lib/agentRuntime';
import {
  formatCpu,
  formatMemory,
  formatUptime,
  freeSeats,
  isRunningStatus,
  locationCapacityText,
  METRICS_UNAVAILABLE_REASON,
  metricsUnavailable,
  resourceLimitText,
  statusDetail,
  statusPill,
} from '../../../../lib/agentRuntimeStatus';
import { canViewScreen } from '../../../../lib/agentScreen';
import { handleApiError } from '../../../../lib/api-error';
import { issuePath } from '../../../../lib/appUrl';
import { missingRepoHosts as missingHostsOf } from '../../../../lib/repoHosts';
import { parseIssueKeyQuery } from '../../../../lib/sendToChat';
import { cn, objectParticle, subjectParticle } from '../../../../lib/utils';
import type { AgentResponse } from '../../../../types/agent';
import type { AgentRuntimeSetting, AgentTemplate } from '../../../../types/agentRuntime';
import { AgentScreenDialog } from './AgentScreenDialog';
import type { WorkSettingsDraft } from './useWorkSettingsDraft';

/** Works 가 실행하는 AI 의 실행 정보 — 상세 페이지가 한 번 읽어 상태·실행 섹션에 함께 내려준다. */
export interface WorksRun {
  template: AgentTemplate;
  saved: AgentRuntimeSetting | null;
  draft: WorkSettingsDraft | null;
}

interface Props {
  agent: AgentResponse;
  worksRun: WorksRun | null;
}

export function AgentStatusSection({ agent, worksRun }: Props) {
  return (
    <SettingsSection
      id={AGENT_DETAIL_SECTION_IDS.status}
      title="상태"
      description="이 AI 를 쓸 수 있는지, 그리고 지금 무엇을 하는지예요."
      data-testid="agent-status-section"
    >
      <UseToggle agent={agent} running={worksRun?.saved?.desired === 'RUN'} />
      {agent.runMode === 'WORKSPACE' && worksRun && <RunGroup agent={agent} run={worksRun} />}
      {agent.runMode === 'EXTERNAL' && (
        // 목록 「실행」 열과 같은 문구(마지막 접속 5분 전·아직 접속 안 함).
        <div className="border-t pt-4 text-sm" data-testid="agent-last-access">
          {externalKeyStatusText(agent.lastKeyUsedAt)}
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * 「사용」 스위치 — 사용 중지는 확인 창 ③을 거치고, 사용으로 바꿀 때는 바로 반영한다(#50).
 * 공통 비서는 지정을 먼저 풀어야 중지할 수 있고(서버도 409), 개인 비서는 주인이 관리해 관리자는 바꾸지 않는다(WP-1163).
 */
function UseToggle({ agent, running }: { agent: AgentResponse; running: boolean }) {
  const invalidateRuntime = useInvalidateRuntime();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lockReason =
    agent.type === 'PERSONAL'
      ? '이 AI 는 주인이 관리해요.'
      : agent.type === 'WORKSPACE' && agent.isActive
        ? '공통 비서 지정을 먼저 풀어 주세요.'
        : null;

  const setActive = async (active: boolean) => {
    setPending(true);
    try {
      await usersApi.setUserActive(agent.id, { active });
      // 목록의 「사용 중지」 배지·이 상세와, 사용 중지가 함께 멈춘 실행(상태·실행 환경 자리)을 같이 다시 읽는다.
      invalidateRuntime();
    } catch (e) {
      handleApiError(e, '사용 상태를 바꾸지 못했습니다.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SettingsToggleRow
        label="사용"
        description={lockReason ?? '사용을 중지하면 이 워크스페이스에 접속하거나 일할 수 없어요.'}
        data-testid="agent-use-toggle"
        control={
          <Switch
            checked={agent.isActive}
            onCheckedChange={(next) => (next ? void setActive(true) : setConfirmOpen(true))}
            disabled={pending || lockReason != null}
            aria-label="사용"
          />
        }
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>사용을 중지할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {agent.name}
              {subjectParticle(agent.name)} 이 워크스페이스에 접속하거나 일할 수 없게 돼요.
              {running ? ' 지금 실행 중이라 실행도 멈춰요.' : ''} 다시 사용으로 바꿔도 실행은 직접 시작해야 해요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                void setActive(false);
              }}
            >
              사용 중지
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** 「WD-319」 → 이슈 상세 경로. 형식이 아니면 null. */
function issueKeyPath(key: string): string | null {
  const k = parseIssueKeyQuery(key);
  return k ? issuePath(k.projectKey, k.number) : null;
}

/** 이슈 키 뒤 목적격 조사 — 「WP-1271 을」. 숫자로 끝나면 읽는 소리(일·이·삼…)의 받침으로 고른다. */
function keyObjectParticle(key: string): string {
  const last = key.slice(-1);
  if (/\d/.test(last)) return '013678'.includes(last) ? '을' : '를';
  return objectParticle(key);
}

/** 확인 창 ①의 종류 — 쉴 때 적용을 지금 하기 / 다시 시작. */
type NowConfirm = 'apply' | 'restart' | null;

/**
 * 「실행」 묶음 — 상태 종류: 꺼짐 · 시작하는 중 · 작업 중 · 쉬는 중 · 막힘 · 실패 · 멈추는 중(statusPill).
 * 꺼져 있으면 실행 전 확인(Claude 연결 · 저장소 연결 · 맡는 프로젝트 · 실행 환경 여유)과 실행 시작, 저장 안 한 작업 설정이 있으면 「저장하고 실행 시작」.
 */
function RunGroup({ agent, run }: { agent: AgentResponse; run: WorksRun }) {
  const { template, saved, draft } = run;
  const locations = useAgentLocations();
  const projects = useAgentRuntimeProjects(agent.id);
  const credential = useAgentProviderCredentialMeta(agent.id);
  const needsRepos = template.requires.includes('repo');
  const repoCredentials = useAgentRepoCredentials(agent.id, needsRepos);
  const save = useSaveAgentRuntimeSetting(agent.id);
  const action = useAgentRuntimeAction(agent.id);
  const [nowConfirm, setNowConfirm] = useState<NowConfirm>(null);
  const [screenOpen, setScreenOpen] = useState(false);

  const status = saved?.status ?? 'OFF';
  const observed = saved?.observed ?? null;
  const running = isRunningStatus(status);
  // 원하는 상태가 RUN 인데 실패면 자리는 이미 잡혀 있어 확인 없이 「다시 시작」·「실행 멈춤」.
  const failedOn = status === 'FAILED' && saved?.desired === 'RUN';
  const off = !running && !failedOn && status !== 'STOPPING';
  const pill = statusPill(status, observed?.agentState);
  const detail = saved
    ? statusDetail({
        status,
        agentState: observed?.agentState,
        agentIssueKey: observed?.agentIssueKey,
        agentNextCheckAt: observed?.agentNextCheckAt,
        message: observed?.message,
      })
    : null;
  const detailPath = detail?.kind === 'issue' ? issueKeyPath(detail.text) : null;
  const working = running && observed?.agentState === 'WORKING';
  const issueKey = observed?.agentIssueKey ?? null;
  // 알약 옆 설명 — 이슈 키·다음 확인·실패 사유가 없을 때 그 상태가 무엇인지 한 줄로.
  const stateNote =
    status === 'STARTING' || (running && observed?.agentState == null)
      ? '작업 공간을 준비하고 있어요'
      : status === 'STOPPING'
        ? '하던 일을 정리하고 있어요'
        : running && observed?.agentState === 'BLOCKED'
          ? '사람의 답을 기다리고 있어요'
          : null;

  // 실행 전 확인 — Claude 연결(이 AI 의 AI 계정이 Claude 구독인지)·맡는 프로젝트·실행 환경 여유.
  const defaultLocation = locations.data?.find((l) => l.isDefault) ?? null;
  // 초안이 있으면 초안 값 그대로 — 초안의 null 은 「워크스페이스 기본」이라 ?? 로 저장값에 떨어지면 안 된다.
  const locationId = draft ? draft.locationId : (saved?.locationId ?? null);
  const target = locationId == null ? defaultLocation : (locations.data?.find((l) => l.id === locationId) ?? null);
  const needsClaude = template.requires.includes('claude');
  const claudeOk = credential.data?.provider === 'anthropic';
  const projectCount = projects.data?.length ?? 0;
  // 맡는 프로젝트 저장소 호스트 중 토큰이 없는 것(WP-1268) — 두 목록을 다 받은 뒤에만 판정해 로딩 중에 잠깐 「빠짐」으로 깜박이지 않게.
  const missingRepoHosts = needsRepos && projects.data && repoCredentials.data ? missingHostsOf(projects.data, repoCredentials.data) : [];
  const seatOk = target != null && freeSeats(target) > 0;
  const blocked = startBlockReason({
    needsClaude,
    claudeOk,
    needsRepos,
    missingRepoHosts,
    projectCount,
    hasLocation: (locations.data?.length ?? 0) > 0,
    seatOk,
    missingRequired: draft?.missingRequired ?? false,
    inactive: !agent.isActive,
  });
  const dirty = draft?.dirty ?? false;
  const pendingReq = save.isPending || action.isPending;
  const limit = resourceLimitText(template);

  // 실행 시작 — 저장 안 한 작업 설정이 있으면 먼저 저장하고 시작한다.
  const onStart = () => {
    if (dirty && draft) save.mutate(draft.body(), { onSuccess: () => action.mutate('start') });
    else action.mutate('start');
  };
  // 실패한 채 실행 중이면 — 바뀐 설정은 NOW 로 저장해 바로 다시 만들고, 아니면 다시 시작(서버가 다시 만든다).
  const onRetry = () => {
    if (dirty && draft) save.mutate(draft.body('NOW'));
    else action.mutate('start');
  };
  // 지금 적용 — 같은 설정을 NOW 로 다시 보내 작업 중이어도 바로 다시 만든다. 일하는 중이면 확인 창 ①.
  const applyNow = () => saved && save.mutate({ templateName: saved.templateName, locationId: saved.locationId, config: saved.config, applyMode: 'NOW' });
  const onApplyNow = () => (working ? setNowConfirm('apply') : applyNow());
  const onRestart = () => (working ? setNowConfirm('restart') : action.mutate('restart'));
  // 실제로 도는 실행 환경이 사용량을 잴 수 없다고 알려 왔으면 CPU·메모리를 「알 수 없음」으로(WP-1280)
  const usageUnknown = metricsUnavailable(saved?.effectiveLocation);

  return (
    <div className="space-y-3 border-t pt-4" data-testid="agent-run-group">
      <h3 className="text-sm font-semibold">실행</h3>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge type={pill.type} data-testid="agent-runtime-status">
          {pill.label}
        </StatusBadge>
        {detail &&
          (detailPath ? (
            <Link to={detailPath} className="font-mono text-xs text-primary hover:underline" data-testid="agent-runtime-detail">
              {detail.text}
            </Link>
          ) : (
            <span className={cn('text-xs', detail.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')} data-testid="agent-runtime-detail">
              {detail.text}
            </span>
          ))}
        {stateNote && <span className="text-xs text-muted-foreground">{stateNote}</span>}
        {working && observed?.startedAt && (
          <span className="text-xs text-muted-foreground">{formatUptime(observed.startedAt, new Date())}째</span>
        )}
        {(running || failedOn) && saved?.effectiveLocation && (
          <span className="ml-auto text-xs text-muted-foreground">실행 환경 {saved.effectiveLocation.name}</span>
        )}
        {/* 작업 화면 보기(WP-1277) — 작업 공간이 떠 있을 때만(시작하는 중·멈추는 중·실패는 붙을 화면이 없다) */}
        {canViewScreen(status) && (
          <Button size="xs" variant="outline" className={cn(!saved?.effectiveLocation && 'ml-auto')} onClick={() => setScreenOpen(true)} data-testid="agent-screen-open">
            <MonitorPlay aria-hidden />
            작업 화면 보기
          </Button>
        )}
      </div>
      {screenOpen && <AgentScreenDialog agentUserId={agent.id} agentName={agent.name} open={screenOpen} onOpenChange={setScreenOpen} />}

      {running && observed && (
        <div className="space-y-1.5">
          <dl className="grid max-w-md grid-cols-3 gap-2" data-testid="agent-runtime-stats">
            {[
              ['CPU', usageUnknown ? '알 수 없음' : formatCpu(observed.cpuMillicores)],
              ['메모리', usageUnknown ? '알 수 없음' : formatMemory(observed.memoryBytes, null)],
              ['최대', limit ?? '-'],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="truncate text-sm font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {/* 사용량을 잴 수 없는 실행 환경(WP-1280) — 「아직 측정 전」과 구분되게 이유를 한 줄로 */}
          {usageUnknown && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="agent-runtime-metrics-unavailable">
              <Info className="size-3.5 shrink-0" aria-hidden />
              {METRICS_UNAVAILABLE_REASON}
            </p>
          )}
        </div>
      )}

      {status === 'APPLY_PENDING' && (
        <div
          className="flex max-w-2xl flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-foreground"
          data-testid="agent-runtime-apply-pending"
        >
          <span className="flex-1">바꾼 작업 설정은 쉴 때 적용돼요.</span>
          <Button size="sm" variant="outline" disabled={pendingReq} onClick={onApplyNow} data-testid="agent-runtime-apply-now">
            지금 적용
          </Button>
        </div>
      )}

      {off && (
        <>
          <ul className="max-w-2xl space-y-1.5 text-sm" data-testid="agent-runtime-checks">
            {needsClaude && (
              <li className="flex flex-wrap items-center gap-x-2">
                <CheckMark ok={claudeOk} />
                <span>Claude 연결</span>
                {!claudeOk && (
                  <span className="text-xs text-muted-foreground">
                    {credential.data ? '— Claude 가 아닌 AI 계정이 연결돼 있어요. 아래 실행 › AI 계정에서 바꿔 주세요' : '— 아래 실행 › AI 계정에서 연결해 주세요'}
                  </span>
                )}
              </li>
            )}
            {needsRepos && (
              <li className="flex flex-wrap items-center gap-x-2" data-testid="agent-runtime-check-repos">
                <CheckMark ok={missingRepoHosts.length === 0} />
                <span>저장소 연결</span>
                {missingRepoHosts.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    — {missingRepoHosts.join(', ')} 가 연결돼 있지 않아요. 아래 실행 › 저장소 연결에서 연결해 주세요
                  </span>
                )}
              </li>
            )}
            <li className="flex flex-wrap items-center gap-x-2">
              <CheckMark ok={projectCount > 0} />
              {projectCount > 0 ? (
                <>
                  <span>맡는 프로젝트 {projectCount}개</span>
                  <span className="text-xs text-muted-foreground">{projects.data?.map((p) => p.projectKey).join(' · ')}</span>
                </>
              ) : (
                <span>
                  맡는 프로젝트{' '}
                  <span className="text-xs text-muted-foreground">— 이 AI 가 멤버이고 저장소가 연결된 프로젝트가 없어요</span>{' '}
                  <Link to="/projects" className="text-xs text-primary hover:underline">
                    프로젝트에 추가하러 가기
                  </Link>
                </span>
              )}
            </li>
            <li className="flex flex-wrap items-center gap-x-2">
              <CheckMark ok={seatOk} />
              {target ? (
                <>
                  <span>실행 환경 여유</span>
                  <span className="text-xs text-muted-foreground">{locationCapacityText(target)}</span>
                </>
              ) : (
                <>
                  <span>실행 환경이 없어요</span>
                  <Link to="/settings/agents/locations" className="text-xs text-primary hover:underline">
                    실행 환경 추가
                  </Link>
                </>
              )}
            </li>
          </ul>
          {dirty && draft && (
            <p
              className="max-w-2xl rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
              data-testid="agent-runtime-unsaved"
            >
              실행 › 작업 설정에 저장하지 않은 변경이 있어요({draft.dirtyLabels.join(', ')}).
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(running || failedOn) && (
          <>
            {/* 실행 중이면 지금 설정으로 다시 띄우고(확인 창 ①), 실패면 고친 설정을 저장하고 다시 켠다. */}
            {running ? (
              <Button size="sm" variant="outline" disabled={pendingReq} onClick={onRestart} data-testid="agent-runtime-restart">
                다시 시작
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pendingReq || (draft?.missingRequired ?? false)} onClick={onRetry} data-testid="agent-runtime-start">
                다시 시작
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={pendingReq} onClick={() => action.mutate('stop')} data-testid="agent-runtime-stop">
              실행 멈춤
            </Button>
          </>
        )}
        {off && (
          <>
            <Button size="sm" disabled={pendingReq || blocked != null} onClick={onStart} data-testid="agent-runtime-start">
              {dirty ? '저장하고 실행 시작' : '실행 시작'}
            </Button>
            {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
          </>
        )}
      </div>

      {/* 확인 창 ① — 일하는 중에 지금 적용·다시 시작. 일하는 중이 아니면 확인 없이 바로 한다. */}
      <AlertDialog open={nowConfirm != null} onOpenChange={(o) => !o && setNowConfirm(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{nowConfirm === 'restart' ? '지금 다시 시작할까요?' : '지금 적용할까요?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {agent.name}
              {subjectParticle(agent.name)} {issueKey ? `${issueKey} ${keyObjectParticle(issueKey)}` : '이슈를'} 처리하고 있어요.{' '}
              {nowConfirm === 'restart' ? '지금 다시 시작하면' : '지금 적용하면'} 작업 공간을 새 설정으로 다시 시작하고, 다시 뜬 뒤{' '}
              {issueKey ? `${issueKey} ${keyObjectParticle(issueKey)}` : '하던 이슈를'} 이어 받아요. 커밋하지 않은 변경은 작업 공간에 남아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (nowConfirm === 'restart') action.mutate('restart');
                else applyNow();
                setNowConfirm(null);
              }}
            >
              {nowConfirm === 'restart' ? '다시 시작' : '지금 적용'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 확인 항목 표시 — 통과 ✓(성공 색), 아니면 ✗(경고 색). */
function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="size-4 shrink-0 text-success" aria-label="통과" />
  ) : (
    <X className="size-4 shrink-0 text-warning" aria-label="필요" />
  );
}
