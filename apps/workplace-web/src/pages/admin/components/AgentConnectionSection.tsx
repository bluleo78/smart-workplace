// AGENT 상세 「실행」 섹션의 두 묶음(WP-1281) — 「AI 계정」(연결 상태·다시 연결·연결 끊기)과 「공통 비서」(지정 스위치 + 지정됐을 때 모델·생각의 깊이).
// 예전엔 「AI 연결 및 모델」 카드 하나였는데, 상세 페이지에서 묶음마다 반영 방식(바로 반영)을 보이려고 둘로 나눴다. 둘 다 바로 반영된다.
// 모델/생각의 깊이는 이 에이전트가 "공통 비서로 지정"된 경우에만 편집 가능(백엔드에 에이전트별 모델 저장 컬럼이 없고, workspace 전체
// 공통 비서 슬롯 1개에만 model/thinkingDepth 가 저장되기 때문 — 스코프 아웃, 별도 이슈 필요).
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { SuggestionModelField } from '@/components/ai/SuggestionModelField';
import { VisionInputSelect } from '@/components/ai/VisionInputSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { getAgentModels } from '../../../api/models';
import {
  useAgentProviderCredentialMeta,
  useRevokeAgentProviderCredential,
} from '../../../hooks/queries/useAgentProviderCredential';
import {
  providerModelsKeys,
  useAgentModels,
  useClearWorkspaceAssistant,
  useSetWorkspaceAssistant,
  useUpdateWorkspaceAssistantSettings,
  useWorkspaceAssistant,
} from '../../../hooks/queries/useAssistant';
import { useAssistantVisionSetting } from '../../../hooks/useAssistantVisionSetting';
import { useAuth } from '../../../hooks/useAuth';
import { accountFits, accountLabel, isLoginProvider } from '../../../lib/agentAccount';
import { providerIdOf } from '../../../lib/ai/suggestionModel';
import { handleApiError } from '../../../lib/api-error';
import { formatMonthDayClock } from '../../../lib/formatters';
import { presetLabelFor } from '../../../lib/opencode-presets';
import { euroRo } from '../../../lib/utils';
import type { ThinkingDepth } from '../../../types/assistant';
import type { CredentialProvider } from '../../../types/providerCredential';
import { LoginInfoDialog } from './LoginInfoDialog';
import { ProviderCredentialDialog } from './ProviderCredentialDialog';

interface Props {
  agentUserId: number;
  /**
   * 관리자가 연결을 등록·재발급하고 공통 비서로 지정할 수 있는지. 구성원의 개인 비서는 주인의 자격증명으로 주인만을 위해 움직여
   * 서버가 둘 다 막으므로(WP-1163) false 를 넘긴다 — 연결 상태는 보이고 회수만 정리 수단으로 남는다.
   * 예전에 공통 비서로 지정된 채 남은 개인 비서는 지정을 끄는 스위치만 함께 남는다(WP-1170).
   */
  canConfigure: boolean;
}

/** 묶음 하나를 다 그린다 — 예전 「AI 연결 및 모델」 카드와 같은 순서(테스트·옛 호출부 호환). 상세 페이지는 두 묶음을 따로 쓴다. */
export function AgentConnectionSection({ agentUserId, canConfigure }: Props) {
  return (
    <section className="space-y-4" data-testid="agent-connection-section">
      <AgentAiAccountGroup agentUserId={agentUserId} canConfigure={canConfigure} />
      <WorkspaceAssistantGroup agentUserId={agentUserId} canConfigure={canConfigure} />
    </section>
  );
}

/** 공급자 이름 — anthropic 은 「Claude 구독」, opencode 는 프리셋 역매핑(미매칭 시 「OpenAI 호환」). */
function providerLabel(meta: { provider: CredentialProvider; baseUrl: string | null }): string {
  return meta.provider === 'opencode' ? (presetLabelFor(meta.baseUrl) ?? accountLabel('opencode')) : accountLabel(meta.provider);
}

/**
 * 「AI 계정」 묶음(바로 반영) — 이 AI 가 부를 AI 모델의 연결. 연결 정보(공급자·Base URL·등록·최근 사용) + 다시 연결 · 연결 끊기 / 연결하기.
 * readOnly(사용 중지된 AI)면 정보만 보인다. 개인 비서(canConfigure=false)는 연결 등록·다시 연결을 주인만 하므로 연결 끊기만 정리 수단으로 남는다(WP-1163).
 *
 * required(템플릿 실행 화면, WP-1296·1297) — 그 템플릿이 쓰는 계정 종류. 연결 창은 그 종류만 받고(로그인 정보면 로그인 정보 창),
 * 다른 종류가 연결돼 있으면 「이 방식으로는 일하지 못해요」를 알린다. 없으면(기본 방식) 지금처럼 Claude 구독·OpenAI 호환 중에 고른다.
 */
export function AgentAiAccountGroup({
  agentUserId,
  canConfigure,
  readOnly = false,
  required,
}: Props & { readOnly?: boolean; required?: CredentialProvider }) {
  const { data: meta, isLoading } = useAgentProviderCredentialMeta(agentUserId);
  const revoke = useRevokeAgentProviderCredential(agentUserId);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 연결 끊기 확인 창. window.confirm 대체 (#136).
  const [revokeOpen, setRevokeOpen] = useState(false);

  const doRevoke = async () => {
    try {
      await revoke.mutateAsync();
      toast.success('AI 계정 연결을 끊었습니다.');
    } catch (e) {
      handleApiError(e, 'AI 계정 연결을 끊지 못했습니다');
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;

  // 템플릿이 쓰는 종류와 다른 계정이 연결돼 있으면 이 방식으로는 일하지 못한다 — 다시 연결을 권한다.
  const mismatch = required != null && meta != null && !accountFits(meta.provider, { mode: 'WORKSPACE', template: { account: required } });
  const loginRequired = required != null && isLoginProvider(required) ? required : null;

  return (
    <div className="space-y-3" data-testid="agent-ai-account">
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Badge variant="secondary" data-testid="credential-provider-badge">
            {providerLabel(meta)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {meta.baseUrl ? <span className="font-mono">{meta.baseUrl} · </span> : null}
            {meta.account ? <span data-testid="credential-account">{meta.account} · </span> : null}
            등록 {formatMonthDayClock(meta.createdAt)} · 최근 사용 {meta.lastUsedAt ? formatMonthDayClock(meta.lastUsedAt) : '없음'}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {loginRequired ? `이 방식은 ${accountLabel(loginRequired)}${euroRo(accountLabel(loginRequired))} 일해요. ` : null}
          아직 연결하지 않았어요.
        </p>
      )}

      {mismatch && (
        <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning" data-testid="credential-mismatch">
          이 방식은 {accountLabel(required)}{euroRo(accountLabel(required))} 일해요. 지금 연결({providerLabel(meta)})로는 일하지 못하니 다시 연결해 주세요.
        </p>
      )}

      {/* WP-1170: 개인 비서인데 연결도 없으면 둘 단추가 없다 — 빈 줄이 틈을 남기지 않게 그리지 않는다. */}
      {!readOnly && (meta || canConfigure) && (
        <div className="flex gap-2">
          {meta ? (
            <>
              {canConfigure && (
                <Button size="sm" variant={mismatch ? 'default' : 'outline'} onClick={() => setDialogOpen(true)} data-testid="oauth-token-reissue">
                  다시 연결
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setRevokeOpen(true)}
                disabled={revoke.isPending}
                data-testid="oauth-token-revoke"
              >
                연결 끊기
              </Button>
            </>
          ) : canConfigure ? (
            <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="oauth-token-register">
              {loginRequired ? `${accountLabel(loginRequired)} 연결` : '연결하기'}
            </Button>
          ) : null}
        </div>
      )}

      {/* WP-1163: 개인 비서는 연결 등록·다시 연결과 공통 비서 지정을 주인만 정한다 — 단추·스위치 대신 안내. */}
      {!canConfigure && (
        <p className="text-xs text-muted-foreground" data-testid="connection-personal-hint">
          이 AI 의 AI 계정은 주인이 관리해요.
        </p>
      )}

      {loginRequired ? (
        <LoginInfoDialog open={dialogOpen} onOpenChange={setDialogOpen} agentUserId={agentUserId} provider={loginRequired} isReissue={meta != null} />
      ) : (
        <ProviderCredentialDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          agentUserId={agentUserId}
          isReissue={meta != null}
          only={required != null && !isLoginProvider(required) ? required : undefined}
        />
      )}

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent data-testid="oauth-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>AI 계정 연결을 끊을까요?</AlertDialogTitle>
            <AlertDialogDescription>연결을 끊으면 이 AI 는 AI 모델을 부를 수 없어 일하지 못해요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="oauth-revoke-cancel">취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void doRevoke()} data-testid="oauth-revoke-confirm">
              연결 끊기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 「공통 비서」 묶음(바로 반영) — 지정 스위치 · 지정됨 배지 · 지정/해제 확인 창 · 연결 먼저 안내 · 토큰 없음 경고.
 * 지정됐을 때만 모델·이미지 입력·생각의 깊이·추천 질문 모델(워크스페이스 공통 값)을 고친다.
 */
export function WorkspaceAssistantGroup({ agentUserId, canConfigure }: Props) {
  // 공통 비서 지정/해제 시 관리자 본인의 aiAvailable 도 즉시 갱신(페이지 새로고침 불필요).
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: meta, isLoading } = useAgentProviderCredentialMeta(agentUserId);
  const { data: ws } = useWorkspaceAssistant();
  const setAssistant = useSetWorkspaceAssistant();
  const clearAssistant = useClearWorkspaceAssistant();
  const updateSettings = useUpdateWorkspaceAssistantSettings();

  // 공통 비서 지정 전 모델 프로브 진행 중 — 토글 중복 클릭 방지 (#643).
  const [probing, setProbing] = useState(false);
  // 프로브 실패(또는 사용 가능 모델 0개)에도 강제 지정할지 확인하는 AlertDialog (#643).
  const [forceSetOpen, setForceSetOpen] = useState(false);
  // 공통 비서 해제 시 영향 경고 확인 AlertDialog (#643) — 해제하면 개인 비서
  // 미지정 구성원 전원이 AI 를 못 쓰게 되므로 실수 방지.
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const hasToken = meta != null;
  // 현재 공통 비서 여부 — 모델/생각의 깊이 편집 가능 조건과 동일(기존 WorkspaceAssistantSection 규칙 유지).
  const isCurrent = ws?.agentUserId === agentUserId;
  // 공통 비서 지정 블록 노출(WP-1170) — 관리자가 설정할 수 있는 에이전트면 늘, 개인 비서는 지정이 남아 있을 때만(끄기 전용).
  const showAssistantToggle = canConfigure || isCurrent;

  // 모델 목록 — 공통 비서일 때만 조회. 저장된 자격증명 기준.
  const { data: modelsData, isLoading: modelsLoading } = useAgentModels(
    isCurrent ? agentUserId : null,
  );
  const modelOptions = modelsData?.models ?? [];

  // 실제 공통 비서 지정 API 호출 — 프로브 통과(또는 강제 확인) 후에만 호출된다.
  const doSetAssistant = async () => {
    try {
      await setAssistant.mutateAsync(agentUserId);
      toast.success('공통 비서로 지정했습니다.');
      void refreshUser();
    } catch (e) {
      handleApiError(e, '공통 비서 지정에 실패했습니다.');
    }
  };

  // 실제 공통 비서 해제 API 호출 — 영향 경고 확인 후에만 호출된다.
  const doClearAssistant = async () => {
    try {
      await clearAssistant.mutateAsync();
      toast.success('공통 비서 지정을 해제했습니다.');
      void refreshUser();
    } catch (e) {
      handleApiError(e, '공통 비서 해제에 실패했습니다.');
    }
  };

  // 공통 비서 지정/해제 — 토글 하나로 표현(기존 지정/지정 해제 버튼 통합).
  // 지정(ON) 은 저장된 자격증명으로 모델 프로브가 실제로 성공하는지 먼저 확인하고,
  // 실패(또는 사용 가능 모델 0개)면 확인 다이얼로그로 명시적 동의를 받는다 — 무효 연결이
  // 그대로 워크스페이스 공통 비서가 되는 것을 막는다 (#643).
  // 해제(OFF) 는 개인 비서 미지정 구성원 전원이 AI 를 못 쓰게 될 수 있음을 경고 후 진행한다.
  const onToggleAssistant = async (checked: boolean) => {
    if (!checked) {
      setClearConfirmOpen(true);
      return;
    }

    setProbing(true);
    try {
      // useAgentModels 훅과 동일한 쿼리키로 캐시 — 지정 성공 후 isCurrent 가 true 로
      // 바뀌어도 방금 검증한 결과를 재사용해 같은 엔드포인트를 중복 호출하지 않는다.
      const result = await queryClient.fetchQuery({
        queryKey: providerModelsKeys.forAgent(agentUserId),
        queryFn: () => getAgentModels(agentUserId),
      });
      if (result.models.length > 0) {
        await doSetAssistant();
      } else {
        setForceSetOpen(true);
      }
    } catch {
      // 프로브 자체가 실패(502 등) — 강제 지정 확인 다이얼로그로 전환.
      setForceSetOpen(true);
    } finally {
      setProbing(false);
    }
  };

  // WP-250: 등록 후 이미지 입력 지정(OpenAI 호환 연결만)과 모델 변경 — 재등록 없이 커스텀 모델의 이미지 입력을 지정할 수 있다.
  // 모델 변경·이미지 입력 저장 규칙(모델을 바꾸면 자동 감지로)은 개인 비서 화면과 같은 훅이 정한다.
  // WP-1322: 생각의 깊이(선택지·보정·모델 변경 시 보정 저장)도 같은 훅이 정한다.
  const {
    isOpencode,
    currentVision,
    changeModel: onModel,
    changeVision: onVision,
    depthView,
    changeDepth: onDepth,
  } = useAssistantVisionSetting({
    provider: meta?.provider,
    vision: ws?.vision,
    model: ws?.model,
    thinkingDepth: ws?.thinkingDepth,
    models: modelOptions,
    modelsLoading,
    save: updateSettings.mutateAsync,
    messages: { success: '설정을 변경했습니다.', error: '설정 변경에 실패했습니다.' },
  });

  // WP-139: 공통 비서 추천 질문 모델 — 이 필드만 보낸다. null = 자동.
  const onSuggestionModel = async (suggestionModel: string | null) => {
    try {
      await updateSettings.mutateAsync({ suggestionModel });
      toast.success('설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '설정 변경에 실패했습니다.');
    }
  };

  if (isLoading) return null;
  if (!showAssistantToggle) return null;

  return (
    <div className="space-y-3" data-testid="workspace-assistant-group">
          {/* 공통 비서 지정 — 토글 하나로 지정/해제. 연결 안 됐으면 비활성 + 안내. 개인 비서는 지정할 수 없어 그리지 않는다.
              WP-1170: 단, 예전에 공통 비서로 지정된 채 남은 개인 비서는 관리자가 끌 수 있게 「✓ 지정됨」과 끄는 스위치를 보인다.
              꺼지면 isCurrent 가 거짓이 되어 블록이 사라지므로 다시 지정할 길은 없다. */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="agent-connection-assistant-toggle" className="text-sm font-medium">
                  이 에이전트를 공통 비서로 지정
                </Label>
                {isCurrent ? (
                  <Badge
                    variant="secondary"
                    data-testid="workspace-assistant-current"
                    className="text-xs"
                  >
                    ✓ 지정됨
                  </Badge>
                ) : null}
              </div>
              {/* 토큰 등록 안내는 관리자가 연결을 정할 수 있을 때만 — 개인 비서는 주인만 연결한다(WP-1170). */}
              {canConfigure && isCurrent && ws && !ws.hasActiveToken ? (
                <p data-testid="workspace-assistant-warn" className="text-xs text-destructive">
                  이 비서에 연결된 AI 계정이 없어요. 위 AI 계정을 연결해야 공통 비서가 답할 수 있어요.
                </p>
              ) : !hasToken && !isCurrent ? (
                <p data-testid="workspace-assistant-token-gate" className="text-xs text-muted-foreground">
                  AI 계정을 먼저 연결해야 공통 비서로 지정할 수 있어요.
                </p>
              ) : null}
            </div>
            <Switch
              id="agent-connection-assistant-toggle"
              data-testid="agent-connection-assistant-toggle"
              checked={isCurrent}
              onCheckedChange={(checked) => void onToggleAssistant(checked)}
              disabled={
                // 지정에는 연결이 필요하지만, 이미 지정된 비서를 끄는 데는 필요 없다 — 연결이 회수된 채 남은 지정도 끌 수 있게(WP-1170).
                (!hasToken && !isCurrent) || setAssistant.isPending || clearAssistant.isPending || probing
              }
            />
          </div>
          {/* 모델·생각의 깊이 — 공통 비서로 지정된 경우에만 편집 가능(백엔드 제약, 스코프 아웃 항목). */}
          {isCurrent ? (
            <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="workspace-assistant-model">
                  모델
                </label>
                <Select
                  value={ws?.model ?? ''}
                  onValueChange={onModel}
                  disabled={modelsLoading || modelOptions.length === 0}
                >
                  <SelectTrigger id="workspace-assistant-model" data-testid="workspace-assistant-model">
                    <SelectValue placeholder="선택…" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!modelsLoading && modelOptions.length === 0 ? (
                  <p
                    data-testid="workspace-assistant-model-empty"
                    className="text-xs text-muted-foreground"
                  >
                    고를 수 있는 모델이 없어요. AI 계정 연결이 정상인지 확인하세요.
                  </p>
                ) : null}
              </div>
              {/* WP-250: 모델 옆 — 지금 모델의 이미지 입력 지정. 고르면 바로 저장되고, 모델을 바꾸면 자동 감지로 돌아간다(OpenAI 호환 연결만). */}
              {isOpencode ? (
                <VisionInputSelect
                  id="workspace-assistant-vision"
                  settingsSpacing="space-y-1"
                  testId="workspace-assistant-vision"
                  value={currentVision}
                  onChange={(v) => void onVision(v)}
                  disabled={updateSettings.isPending}
                />
              ) : null}
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="workspace-assistant-depth">
                  생각의 깊이
                </label>
                {/* WP-1322: 「설정 안 함」 + 고른 모델이 받는 단계만. */}
                <Select
                  value={depthView.value}
                  onValueChange={(v) => void onDepth(v as ThinkingDepth)}
                  disabled={modelsLoading}
                >
                  <SelectTrigger id="workspace-assistant-depth" data-testid="workspace-assistant-depth">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {depthView.options.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* WP-139: 추천 질문 모델 — 공통 비서일 때만(같은 그리드 규칙). 직접 입력 접두는 비서 모델에서 따온다. */}
              <SuggestionModelField
                id="workspace-assistant-suggestion-model"
                autoModel={ws?.suggestionModelAuto}
                value={ws?.suggestionModel}
                options={modelOptions}
                loading={modelsLoading}
                saving={updateSettings.isPending}
                providerId={providerIdOf(ws?.model)}
                onChange={(v) => void onSuggestionModel(v)}
              />
            </div>
          ) : null}

      {/* 모델 프로브 실패(또는 사용 가능 모델 0개) 상태에서 강제 지정 확인 (#643). */}
      <AlertDialog open={forceSetOpen} onOpenChange={setForceSetOpen}>
        <AlertDialogContent data-testid="workspace-assistant-force-set-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>연결 검증에 실패했습니다</AlertDialogTitle>
            <AlertDialogDescription>
              이 에이전트의 AI 계정으로 모델을 확인하지 못했어요. 그래도 공통 비서로 지정하면 워크스페이스 전체가 AI 를 쓰지
              못할 수 있어요. 계속할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="workspace-assistant-force-set-cancel">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setForceSetOpen(false);
                void doSetAssistant();
              }}
              data-testid="workspace-assistant-force-set-confirm"
            >
              그래도 지정
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 공통 비서 해제 영향 경고 확인 (#643). */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent data-testid="workspace-assistant-clear-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>공통 비서 지정 해제</AlertDialogTitle>
            <AlertDialogDescription>
              공통 비서 지정을 해제하면 개인 비서를 지정하지 않은 구성원은 AI 를 사용할 수
              없게 됩니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="workspace-assistant-clear-confirm-cancel">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setClearConfirmOpen(false);
                void doClearAssistant();
              }}
              data-testid="workspace-assistant-clear-confirm-confirm"
            >
              해제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
