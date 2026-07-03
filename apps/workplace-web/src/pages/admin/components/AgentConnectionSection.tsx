// AGENT 상세 — "AI 연결 및 모델" 통합 섹션.
// 기존 OAuthTokenSection(연결 상태/재발급/회수) + WorkspaceAssistantSection(공통 비서 지정 +
// 모델/생각의 깊이)을 카드 하나로 합쳤다. 모델/생각의 깊이는 이 에이전트가 "공통 비서로 지정"된
// 경우에만 편집 가능(백엔드에 에이전트별 모델 저장 컬럼이 없고, workspace 전체 공통 비서 슬롯 1개에만
// model/thinkingDepth 가 저장되기 때문 — 스코프 아웃, 별도 이슈 필요).
import { useState } from 'react';
import { toast } from 'sonner';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import {
  useAgentProviderCredentialMeta,
  useRevokeAgentProviderCredential,
} from '../../../hooks/queries/useAgentProviderCredential';
import {
  useAgentModels,
  useClearWorkspaceAssistant,
  useSetWorkspaceAssistant,
  useUpdateWorkspaceAssistantSettings,
  useWorkspaceAssistant,
} from '../../../hooks/queries/useAssistant';
import { useAuth } from '../../../hooks/useAuth';
import { handleApiError } from '../../../lib/api-error';
import { presetLabelFor } from '../../../lib/opencode-presets';
import type { ThinkingDepth } from '../../../types/assistant';
import { ProviderCredentialDialog } from './ProviderCredentialDialog';

// 생각 깊이 선택 옵션 목록.
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

// 시간 표시 공통 — null/빈값 폴백.
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

interface Props {
  agentUserId: number;
}

export function AgentConnectionSection({ agentUserId }: Props) {
  // 공통 비서 지정/해제 시 관리자 본인의 aiAvailable 도 즉시 갱신(페이지 새로고침 불필요).
  const { refreshUser } = useAuth();
  const { data: meta, isLoading } = useAgentProviderCredentialMeta(agentUserId);
  const revoke = useRevokeAgentProviderCredential(agentUserId);
  const { data: ws } = useWorkspaceAssistant();
  const setAssistant = useSetWorkspaceAssistant();
  const clearAssistant = useClearWorkspaceAssistant();
  const updateSettings = useUpdateWorkspaceAssistantSettings();

  const [dialogOpen, setDialogOpen] = useState(false);
  // API 키 회수 확인 AlertDialog. window.confirm 대체 (#136).
  const [revokeOpen, setRevokeOpen] = useState(false);

  const hasToken = meta != null;
  // 현재 공통 비서 여부 — 모델/생각의 깊이 편집 가능 조건과 동일(기존 WorkspaceAssistantSection 규칙 유지).
  const isCurrent = ws?.agentUserId === agentUserId;

  // 모델 목록 — 공통 비서일 때만 조회. 저장된 자격증명 기준.
  const { data: modelsData, isLoading: modelsLoading } = useAgentModels(
    isCurrent ? agentUserId : null,
  );
  const modelOptions = modelsData?.models ?? [];

  // provider 뱃지 라벨 — anthropic 은 "Claude 구독", opencode 는 프리셋 역매핑(미매칭 시 "OpenAI 호환").
  const providerBadge =
    meta == null
      ? null
      : meta.provider === 'anthropic'
        ? 'Claude 구독'
        : (presetLabelFor(meta.baseUrl) ?? 'OpenAI 호환');

  const onRevokeClick = () => {
    setRevokeOpen(true);
  };

  const doRevoke = async () => {
    try {
      await revoke.mutateAsync();
      toast.success('API 키를 회수했습니다.');
    } catch (e) {
      handleApiError(e, 'API 키 회수에 실패했습니다');
    }
  };

  // 공통 비서 지정/해제 — 토글 하나로 표현(기존 지정/지정 해제 버튼 통합).
  const onToggleAssistant = async (checked: boolean) => {
    try {
      if (checked) {
        await setAssistant.mutateAsync(agentUserId);
        toast.success('공통 비서로 지정했습니다.');
      } else {
        await clearAssistant.mutateAsync();
        toast.success('공통 비서 지정을 해제했습니다.');
      }
      void refreshUser();
    } catch (e) {
      handleApiError(
        e,
        checked ? '공통 비서 지정에 실패했습니다.' : '공통 비서 해제에 실패했습니다.',
      );
    }
  };

  const onModel = async (model: string) => {
    try {
      await updateSettings.mutateAsync({ model });
      toast.success('설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '설정 변경에 실패했습니다.');
    }
  };

  const onDepth = async (thinkingDepth: ThinkingDepth) => {
    try {
      await updateSettings.mutateAsync({ thinkingDepth });
      toast.success('설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '설정 변경에 실패했습니다.');
    }
  };

  return (
    <section className="border-t pt-4 mt-4 space-y-3" data-testid="agent-connection-section">
      <h3 className="text-sm font-medium">AI 연결 및 모델</h3>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">로드 중…</p>
      ) : (
        <>
          {meta ? (
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">연결: </span>
                <Badge variant="secondary" data-testid="credential-provider-badge">
                  {providerBadge}
                </Badge>
              </div>
              {meta.baseUrl ? (
                <div>
                  <span className="text-muted-foreground">Base URL: </span>
                  <span className="font-mono text-xs">{meta.baseUrl}</span>
                </div>
              ) : null}
              <div>
                <span className="text-muted-foreground">등록일: </span>
                <span>{fmtDateTime(meta.createdAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">최근 사용: </span>
                <span>{meta.lastUsedAt ? fmtDateTime(meta.lastUsedAt) : '미사용'}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              아직 연결되지 않았습니다. 연결하면 에이전트가 LLM을 호출할 수 있어요.
            </p>
          )}

          <div className="flex gap-2">
            {meta ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialogOpen(true)}
                  data-testid="oauth-token-reissue"
                >
                  재발급
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onRevokeClick}
                  disabled={revoke.isPending}
                  data-testid="oauth-token-revoke"
                >
                  회수
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="oauth-token-register">
                연결하기
              </Button>
            )}
          </div>

          {/* 모델·생각의 깊이 — 공통 비서로 지정된 경우에만 편집 가능(백엔드 제약, 스코프 아웃 항목). */}
          {isCurrent ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 border-t pt-3">
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
                    사용 가능한 모델이 없어요 — API 키가 등록됐는지, 연결이 정상인지
                    확인하세요.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="workspace-assistant-depth">
                  생각의 깊이
                </label>
                <Select
                  value={ws?.thinkingDepth ?? 'NORMAL'}
                  onValueChange={(v) => void onDepth(v as ThinkingDepth)}
                >
                  <SelectTrigger id="workspace-assistant-depth" data-testid="workspace-assistant-depth">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPTHS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {/* 공통 비서 지정 — 토글 하나로 지정/해제. 연결 안 됐으면 비활성 + 안내. */}
          <div className="flex items-center justify-between border-t pt-3">
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
              {isCurrent && ws && !ws.hasActiveToken ? (
                <p data-testid="workspace-assistant-warn" className="text-sm text-destructive">
                  이 비서에 활성 OAuth 토큰이 없어요. 위 연결에서 토큰을 등록(또는 재발급)해야
                  공통 비서가 동작합니다.
                </p>
              ) : !hasToken ? (
                <p data-testid="workspace-assistant-token-gate" className="text-sm text-muted-foreground">
                  먼저 연결해야 공통 비서로 지정할 수 있어요.
                </p>
              ) : null}
            </div>
            <Switch
              id="agent-connection-assistant-toggle"
              data-testid="agent-connection-assistant-toggle"
              checked={isCurrent}
              onCheckedChange={(checked) => void onToggleAssistant(checked)}
              disabled={!hasToken || setAssistant.isPending || clearAssistant.isPending}
            />
          </div>
        </>
      )}

      <ProviderCredentialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentUserId={agentUserId}
        isReissue={meta != null}
      />

      {/* API 키 회수 확인 AlertDialog. window.confirm 대체 (#136). */}
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent data-testid="oauth-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>API 키 회수</AlertDialogTitle>
            <AlertDialogDescription>
              API 키를 회수하시겠습니까? 에이전트는 LLM 호출 불가 상태가 됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="oauth-revoke-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void doRevoke()}
              data-testid="oauth-revoke-confirm"
            >
              회수
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
