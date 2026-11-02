// 에이전트 상세 「실행」 섹션(WP-1281·1278) — 이 AI 를 무엇으로, 어디서 돌릴지.
// 방식 카드 셋(기본 / Works 실행 방식들 / 외부). 다른 카드를 누르면 그 방식에 필요한 칸이 펼쳐지고 「취소 · 바꾸기」, 바꾸기는 무엇이 달라지는지
// 요약하는 확인 창(②)을 거쳐 저장한다 — 「기본」 카드도 바로 저장하지 않는다(예전엔 눌러서 바로 저장).
// 묶음마다 반영 방식을 제목 옆에 붙인다: AI 계정·공통 비서는 바로 반영, 작업 설정은 저장해야 반영(실행 중이면 쉴 때 적용), 접속 키는 Works 가 관리.

import { useState } from 'react';

import { SettingsSection } from '@/components/layout/SettingsSection';
import { useOpenSettingsGuide } from '@/components/settings-guide/openSettingsGuide';
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

import { useAgentKeys, useRevokeAgentKey } from '../../../../hooks/queries/useAgentKeys';
import { useSaveAgentRuntimeSetting, useUseServerTemplate } from '../../../../hooks/queries/useAgentRuntime';
import { useSetAgentRuntime } from '../../../../hooks/queries/useAgents';
import { useWorkspaceAssistant } from '../../../../hooks/queries/useAssistant';
import {
  currentCardId,
  modeChangeSummary,
  modeChangeTitle,
  type RunModeCard,
  runModeCards,
  withSavedWorkspaceCard,
} from '../../../../lib/agentRunMode';
import { formatDateMonthDayPadded } from '../../../../lib/formatters';
import { cn } from '../../../../lib/utils';
import type { AgentResponse } from '../../../../types/agent';
import type { AgentTemplate } from '../../../../types/agentRuntime';
import { AgentAiAccountGroup, WorkspaceAssistantGroup } from '../AgentConnectionSection';
import { AgentKeyIssueDialog } from '../AgentKeyIssueDialog';
import { AgentKeysSection } from '../AgentKeysSection';
import type { WorksRun } from './AgentStatusSection';
import { DetailGroup } from './DetailGroup';
import { useWorkSettingsDraft } from './useWorkSettingsDraft';
import { WorkSettingsFields } from './WorkSettingsFields';

/** 자동 발급 키를 미리 바꾸기 시작하는 시각 — 만료 7일 전(서버 ManagedKeyChain.ROTATE_BEFORE 와 같다). */
function rotateAfter(expiresAt: string): string {
  return new Date(new Date(expiresAt).getTime() - 7 * 24 * 60 * 60_000).toISOString();
}

interface Props {
  agent: AgentResponse;
  templates: AgentTemplate[] | undefined;
  worksRun: WorksRun | null;
  /** 저장된 작업 공간 방식 이름 — 그 정의가 목록에 없어 worksRun 이 비어도 지금 방식 카드를 그리는 데 쓴다. */
  savedTemplateName: string | null;
}

export function AgentRunSection({ agent, templates, worksRun, savedTemplateName }: Props) {
  const cards = withSavedWorkspaceCard(runModeCards(templates), agent.runMode, savedTemplateName, templates != null);
  const currentId = currentCardId(agent.runMode, savedTemplateName, cards);
  const current = cards.find((c) => c.id === currentId) ?? cards[0];
  // 펼친 다른 카드 — 「바꾸기」로 확인하기 전까지는 저장하지 않는다.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = pendingId ? (cards.find((c) => c.id === pendingId) ?? null) : null;
  // 관리자가 설정할 수 있는 에이전트인지(WP-1170) — 개인 비서는 주인 전용이라 키 발급·연결 등록·공통 비서 지정을 막는다.
  const canAdminConfigure = agent.type !== 'PERSONAL';
  const cardsLock = cardLockReason(agent, worksRun?.saved?.desired === 'RUN');

  // 접속 키 — 발급 직후 1회 보이는 평문 키 + 폐기 확인 창. 기본·외부·남은 키 표가 함께 쓴다.
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revokeKeyId, setRevokeKeyId] = useState<number | null>(null);
  const revoke = useRevokeAgentKey(agent.id);
  const keyProps = { agentId: agent.id, onIssued: setPlaintext, onRevoke: setRevokeKeyId };

  return (
    <SettingsSection
      id={AGENT_DETAIL_SECTION_IDS.run}
      title="실행"
      description="이 AI 를 무엇으로, 어디서 돌릴지예요."
      data-testid="agent-run-section"
    >
      <ModeCards cards={cards} currentId={currentId} pendingId={pendingId} lockReason={cardsLock} onPick={(id) => setPendingId(id === currentId ? null : id)} />

      {pending ? (
        <PendingSwitch agent={agent} from={current} to={pending} fromTemplate={worksRun?.template ?? null} onDone={() => setPendingId(null)} />
      ) : !agent.isActive ? (
        // 사용 중지된 AI(WP-705·WP-1075) — 연결·키는 보기·정리만. 실행 방식·작업 설정은 다시 사용으로 바꾼 뒤에 다룬다.
        <>
          {agent.runMode !== 'EXTERNAL' && (
            <DetailGroup title="AI 계정" data-testid="agent-ai-account-group">
              <AgentAiAccountGroup agentUserId={agent.id} canConfigure={canAdminConfigure} readOnly />
            </DetailGroup>
          )}
          <DetailGroup title="접속 키">
            <AgentKeysSection {...keyProps} canIssue={false} blockedNote="사용 중지된 AI 에는 새 키를 발급하지 않아요. 남은 키는 폐기해 정리할 수 있어요." />
          </DetailGroup>
        </>
      ) : agent.runMode === 'WORKSPACE' && worksRun ? (
        <WorksRunGroups agent={agent} run={worksRun} keyProps={keyProps} />
      ) : agent.runMode === 'WORKSPACE' && templates != null && savedTemplateName ? (
        // 저장된 방식이 릴리스에서 빠졌다 — 작업 설정을 그릴 정의가 없으니 다른 방식으로 바꾸게만 안내한다.
        <p className="text-sm text-muted-foreground" data-testid="agent-run-mode-unsupported">
          이 실행 방식은 지원이 끝났어요. 위에서 다른 방식으로 바꿔 주세요.
        </p>
      ) : agent.runMode === 'EXTERNAL' ? (
        <ExternalKeysGroup agent={agent} keyProps={keyProps} />
      ) : agent.runMode === 'SERVER' ? (
        <ServerGroups agent={agent} canConfigure={canAdminConfigure} keyProps={keyProps} />
      ) : null}

      <AgentKeyIssueDialog
        plaintextKey={plaintext}
        username={agent.runMode === 'EXTERNAL' ? agent.username : null}
        open={plaintext != null}
        onOpenChange={(v) => !v && setPlaintext(null)}
      />
      <AlertDialog open={revokeKeyId != null} onOpenChange={(o) => !o && setRevokeKeyId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>키를 폐기할까요?</AlertDialogTitle>
            <AlertDialogDescription>폐기하면 이 키로는 바로 접속할 수 없어요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => revokeKeyId != null && revoke.mutate(revokeKeyId)}>
              키 폐기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

/**
 * 방식 카드를 고를 수 없는 이유 — 고를 수 있으면 null.
 * 개인 비서·공통 비서는 서버에서 AI 대화를 돌려야 해 기본 고정(서버도 409), 사용 중지면 막힘, 실행 중(원하는 상태 RUN, 실패 포함)이면 서버가 409 로 막는다.
 */
function cardLockReason(agent: AgentResponse, running: boolean): string | null {
  if (agent.type === 'PERSONAL') return '개인 비서는 기본 방식으로만 돌아요.';
  if (agent.type === 'WORKSPACE') return '공통 비서는 기본 방식으로만 돌아요. 다른 방식으로 바꾸려면 공통 비서 지정을 먼저 풀어 주세요.';
  if (!agent.isActive) return '사용 중지된 AI 는 실행 방식을 바꿀 수 없어요.';
  if (running) return '실행 중에는 바꿀 수 없어요. 먼저 실행을 멈춰 주세요.';
  return null;
}

/** 방식 카드 — 고른 카드는 테두리 강조, 펼친(바꾸려는) 카드는 점이 아닌 옅은 배경으로 구분한다. 휴대폰은 세로로 쌓는다. */
function ModeCards({
  cards,
  currentId,
  pendingId,
  lockReason,
  onPick,
}: {
  cards: RunModeCard[];
  currentId: string;
  pendingId: string | null;
  lockReason: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="실행 방식" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {cards.map((c) => {
          const checked = c.id === currentId;
          const picked = c.id === pendingId;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={!checked && lockReason != null}
              data-testid={`agent-run-mode-${c.id}`}
              onClick={() => onPick(c.id)}
              className={cn(
                'flex h-full w-full flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                checked && !pendingId && 'border-primary ring-1 ring-primary',
                checked && pendingId && 'border-primary/50',
                picked && 'border-primary bg-primary/5 ring-1 ring-primary',
                !checked && !picked && 'hover:bg-muted/50',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {c.title}
                {checked && pendingId && <span className="text-xs font-normal text-muted-foreground">지금</span>}
              </span>
              <span className="text-xs text-muted-foreground">{c.description}</span>
            </button>
          );
        })}
      </div>
      {lockReason && (
        <p className="text-xs text-muted-foreground" data-testid="agent-run-mode-lock">
          {lockReason}
        </p>
      )}
    </div>
  );
}

/**
 * 다른 방식으로 바꾸는 중 — 그 방식에 필요한 칸(작업 공간 방식이면 작업 설정)을 펼치고 「취소 · 바꾸기」.
 * 바꾸기 → 확인 창 ②에 달라지는 것을 보이고, 확인하면 저장한다:
 * 기본 = 실행 방식 INTERNAL(서버가 같은 트랜잭션에서 실행 설정을 지움) / 외부 = 실행 설정 삭제 또는 EXTERNAL / 작업 공간 = 실행 설정 저장.
 */
function PendingSwitch({
  agent,
  from,
  to,
  fromTemplate,
  onDone,
}: {
  agent: AgentResponse;
  from: RunModeCard;
  to: RunModeCard;
  fromTemplate: AgentTemplate | null;
  onDone: () => void;
}) {
  const draft = useWorkSettingsDraft(to.template, null);
  const setRuntime = useSetAgentRuntime();
  const useServer = useUseServerTemplate(agent.id);
  const save = useSaveAgentRuntimeSetting(agent.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = setRuntime.isPending || useServer.isPending || save.isPending;
  const summary = modeChangeSummary(from, to, fromTemplate);

  const apply = () => {
    const done = { onSuccess: onDone };
    if (to.mode === 'WORKSPACE') {
      if (draft) save.mutate(draft.body(), done);
      return;
    }
    // 기본 = INTERNAL, 외부 = EXTERNAL. 작업 공간에서 떠나면 실행 설정 삭제와 함께 한 요청으로, 아니면 실행 방식만 바꾼다.
    const runtime = to.mode === 'SERVER' ? 'INTERNAL' : 'EXTERNAL';
    if (from.mode === 'WORKSPACE') useServer.mutate(runtime, done);
    else setRuntime.mutate({ userId: agent.id, runtime }, done);
  };

  return (
    <DetailGroup title={`${to.title}${to.mode === 'WORKSPACE' ? ' 작업 설정' : ''}`} how="바꾸기를 눌러야 반영" data-testid="agent-run-mode-pending">
      {draft ? (
        <WorkSettingsFields draft={draft} idPrefix="pending" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {to.mode === 'SERVER' ? '따로 채울 칸이 없어요. 바꾼 뒤 AI 계정을 연결해 주세요.' : '따로 채울 칸이 없어요. 바꾼 뒤 연결 방법을 따라 키를 발급해 주세요.'}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button disabled={busy || (draft?.missingRequired ?? false)} onClick={() => setConfirmOpen(true)} data-testid="agent-run-mode-apply">
          바꾸기
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="agent-run-mode-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{modeChangeTitle(to)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-disc space-y-1 pl-5 text-left">
                {summary.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={apply} data-testid="agent-run-mode-confirm-apply">
              바꾸기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DetailGroup>
  );
}

type KeyProps = { agentId: number; onIssued: (k: string) => void; onRevoke: (id: number) => void };

/** Works 가 실행하는 AI — AI 계정(Claude 가 필요한 방식만) · 작업 설정 · 접속 키(Works 가 관리 + 남은 직접 발급 키). */
function WorksRunGroups({ agent, run, keyProps }: { agent: AgentResponse; run: WorksRun; keyProps: KeyProps }) {
  const { template, saved, draft } = run;
  const save = useSaveAgentRuntimeSetting(agent.id);
  const keys = useAgentKeys(agent.id);
  const running = saved?.desired === 'RUN';
  // 다음 교체 무렵 — 가장 새로 받은 자동 발급 키의 만료 7일 전(서버 ManagedKeyChain.rotateAfter). 그때부터 새 키를 받아 쉴 때 적용한다.
  const latestManaged = (keys.data ?? [])
    .filter((k) => k.managed && k.revokedAt == null && k.expiresAt)
    .sort((a, b) => b.id - a.id)[0];
  const nextRotation = latestManaged?.expiresAt ? rotateAfter(latestManaged.expiresAt) : null;
  return (
    <>
      {template.requires.includes('claude') && (
        <DetailGroup title="AI 계정" how="바로 반영" data-testid="agent-ai-account-group">
          <AgentAiAccountGroup agentUserId={agent.id} canConfigure />
        </DetailGroup>
      )}
      {draft && (
        <DetailGroup title="작업 설정" how={running ? '저장해야 반영 · 실행 중이면 쉴 때 적용' : '저장해야 반영'} data-testid="agent-work-settings-group">
          <WorkSettingsFields draft={draft} />
          <div className="flex items-center gap-2">
            <Button disabled={!draft.dirty || draft.missingRequired || save.isPending} onClick={() => save.mutate(draft.body())} data-testid="agent-runtime-save">
              저장
            </Button>
            {draft.dirty && (
              <Button variant="ghost" onClick={draft.reset}>
                되돌리기
              </Button>
            )}
          </div>
        </DetailGroup>
      )}
      <DetailGroup title="접속 키" how="Works 가 관리" data-testid="agent-managed-keys-group">
        {nextRotation && (
          <p className="text-xs text-muted-foreground" data-testid="agent-key-next-rotation">
            다음 교체 {formatDateMonthDayPadded(nextRotation)} 무렵
          </p>
        )}
        <AgentKeysSection {...keyProps} canIssue={false} leftoverOnly />
      </DetailGroup>
    </>
  );
}

/** 기본 방식 — AI 계정 · 공통 비서(지정할 수 있거나 예전 지정이 남은 경우) · 접속 키(발급 + 표). */
function ServerGroups({ agent, canConfigure, keyProps }: { agent: AgentResponse; canConfigure: boolean; keyProps: KeyProps }) {
  // 공통 비서 묶음 — 관리자가 설정할 수 있는 에이전트면 늘, 개인 비서는 예전 지정이 남아 있을 때만(끄기 전용, WP-1170).
  const ws = useWorkspaceAssistant();
  const showsAssistant = canConfigure || ws.data?.agentUserId === agent.id;
  return (
    <>
      <DetailGroup title="AI 계정" how="바로 반영" data-testid="agent-ai-account-group">
        <AgentAiAccountGroup agentUserId={agent.id} canConfigure={canConfigure} />
      </DetailGroup>
      {showsAssistant && (
        <DetailGroup title="공통 비서" how="바로 반영" data-testid="agent-assistant-group">
          <WorkspaceAssistantGroup agentUserId={agent.id} canConfigure={canConfigure} />
        </DetailGroup>
      )}
      <DetailGroup title="접속 키">
        <AgentKeysSection
          {...keyProps}
          canIssue={canConfigure}
          keysUnusable={!canConfigure}
          blockedNote={canConfigure ? undefined : '개인 비서의 키는 관리자가 발급할 수 없어요.'}
          leftoverHint={canConfigure ? undefined : '남은 키로는 접속되지 않으니 폐기해 정리하세요.'}
        />
      </DetailGroup>
    </>
  );
}

/**
 * 외부 방식 「접속 키」 — 화면에는 키 발급과 키 표만 둔다. 연결 방법 ②~⑤(플러그인 설치·서버 주소·로그인·자동 처리)는 설정 가이드 단계로 옮겼다(WP-1281).
 * 키가 아직 한 번도 쓰이지 않았으면(연결 전) 가이드로 가는 한 줄을 붙인다.
 */
function ExternalKeysGroup({ agent, keyProps }: { agent: AgentResponse; keyProps: KeyProps }) {
  const keys = useAgentKeys(agent.id);
  const openGuide = useOpenSettingsGuide();
  const neverUsed = keys.data != null && keys.data.every((k) => k.lastUsedAt == null);
  return (
    <DetailGroup title="접속 키" data-testid="external-connect-card">
      <AgentKeysSection {...keyProps} canIssue />
      {neverUsed && openGuide && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="external-connect-guide-hint">
          연결 방법은 설정 가이드에 있어요
          <Button type="button" variant="outline" size="sm" onClick={() => openGuide(AGENT_DETAIL_SECTION_IDS.run)} data-testid="external-connect-guide-open">
            가이드 열기
          </Button>
        </div>
      )}
    </DetailGroup>
  );
}
