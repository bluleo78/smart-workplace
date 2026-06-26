// ADMIN — 에이전트 상세 내 "공통 비서" 섹션.
// 개인 비서를 지정하지 않은 구성원이 공통으로 쓰는 단일 지정 비서.
// 활성 OAuth 토큰이 있는 에이전트만 지정 가능(토큰 게이트는 UX 보호장치).
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useAgentOAuthTokenMeta } from '../../../hooks/queries/useAgentOAuthToken';
import {
  useClearWorkspaceAssistant,
  useSetWorkspaceAssistant,
  useUpdateWorkspaceAssistantSettings,
  useWorkspaceAssistant,
} from '../../../hooks/queries/useAssistant';
import { handleApiError } from '../../../lib/api-error';
import { MODEL_OPTIONS } from '../../../lib/assistant-models';
import type { ThinkingDepth } from '../../../types/assistant';

// 생각 깊이 선택 옵션 목록.
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

interface Props {
  agentUserId: number;
}

/**
 * 에이전트 상세 내 "공통 비서" 섹션.
 * - isCurrent: 이 에이전트가 현재 공통 비서인지 여부.
 * - hasToken: OAuth 토큰이 등록된 경우만 지정 가능(토큰 게이트).
 * - 공통 비서일 때만 모델·생각깊이 설정을 노출.
 */
export function WorkspaceAssistantSection({ agentUserId }: Props) {
  const { data } = useWorkspaceAssistant();
  const { data: oauthMeta } = useAgentOAuthTokenMeta(agentUserId);
  const setAssistant = useSetWorkspaceAssistant();
  const clearAssistant = useClearWorkspaceAssistant();
  const updateSettings = useUpdateWorkspaceAssistantSettings();

  // 현재 공통 비서 여부.
  const isCurrent = data?.agentUserId === agentUserId;
  // OAuth 토큰 등록 여부 — null이면 미등록.
  const hasToken = oauthMeta != null;

  // 공통 비서 지정 — 실패 시 토스트.
  const onAssign = async () => {
    try {
      await setAssistant.mutateAsync(agentUserId);
      toast.success('공통 비서로 지정했습니다.');
    } catch (e) {
      handleApiError(e, '공통 비서 지정에 실패했습니다.');
    }
  };

  // 공통 비서 지정 해제 — 실패 시 토스트.
  const onClear = async () => {
    try {
      await clearAssistant.mutateAsync();
      toast.success('공통 비서 지정을 해제했습니다.');
    } catch (e) {
      handleApiError(e, '공통 비서 해제에 실패했습니다.');
    }
  };

  // 모델 변경.
  const onModel = async (model: string) => {
    try {
      await updateSettings.mutateAsync({ model });
      toast.success('설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '설정 변경에 실패했습니다.');
    }
  };

  // 생각 깊이 변경.
  const onDepth = async (thinkingDepth: ThinkingDepth) => {
    try {
      await updateSettings.mutateAsync({ thinkingDepth });
      toast.success('설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '설정 변경에 실패했습니다.');
    }
  };

  return (
    <Card data-testid="workspace-assistant-card" className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle>공통 비서</CardTitle>
        <CardDescription>
          개인 비서를 지정하지 않은 구성원이 공통으로 쓰는 비서입니다. 워크스페이스에 한 명만 지정됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isCurrent ? (
          /* 현재 공통 비서인 경우: 뱃지 + 해제 버튼 + 토큰 없음 경고. */
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span
                data-testid="workspace-assistant-current"
                className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary"
              >
                ✓ 현재 공통 비서
              </span>
              <Button
                variant="ghost"
                size="sm"
                data-testid="workspace-assistant-clear"
                onClick={() => void onClear()}
                disabled={clearAssistant.isPending}
              >
                지정 해제
              </Button>
            </div>
            {/* 활성 토큰 없음 경고 — 비서가 지정됐으나 OAuth 토큰이 회수된 경우. */}
            {data && !data.hasActiveToken ? (
              <p data-testid="workspace-assistant-warn" className="text-sm text-destructive">
                이 비서에 활성 OAuth 토큰이 없어요. 아래 인증에서 토큰을 등록(또는 재발급)해야 공통 비서가 동작합니다.
              </p>
            ) : null}
          </div>
        ) : (
          /* 비-current인 경우: 지정 버튼(토큰 없으면 비활성) + 안내문. */
          <div className="space-y-2">
            <Button
              size="sm"
              data-testid="workspace-assistant-assign"
              onClick={() => void onAssign()}
              disabled={!hasToken || setAssistant.isPending}
            >
              공통 비서로 지정
            </Button>
            {!hasToken ? (
              <p
                data-testid="workspace-assistant-token-gate"
                className="text-sm text-muted-foreground"
              >
                먼저 아래 인증에서 OAuth 토큰을 등록하면 공통 비서로 지정할 수 있어요.
              </p>
            ) : null}
          </div>
        )}

        {/* 모델·생각깊이 설정 — 공통 비서일 때만 노출. */}
        {isCurrent ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="workspace-assistant-model">
                모델
              </label>
              <Select value={data?.model ?? ''} onValueChange={onModel}>
                <SelectTrigger
                  id="workspace-assistant-model"
                  data-testid="workspace-assistant-model"
                >
                  <SelectValue placeholder="선택…" />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="workspace-assistant-depth">
                생각의 깊이
              </label>
              <Select
                value={data?.thinkingDepth ?? 'NORMAL'}
                onValueChange={(v) => void onDepth(v as ThinkingDepth)}
              >
                <SelectTrigger
                  id="workspace-assistant-depth"
                  data-testid="workspace-assistant-depth"
                >
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
      </CardContent>
    </Card>
  );
}
