// ADMIN — 공용 비서(workspace assistant) 카드.
// 워크스페이스 홈을 기본 담당하는 AGENT 를 지정하고, 활성 OAuth 토큰 유무 경고 +
// 모델/생각의 깊이 설정을 제공한다.

import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { handleApiError } from '../../../lib/api-error';
import { useAgents } from '../../../hooks/queries/useAgents';
import {
  useSetWorkspaceAssistant,
  useUpdateWorkspaceAssistantSettings,
  useWorkspaceAssistant,
} from '../../../hooks/queries/useAssistant';
import type { ThinkingDepth } from '../../../types/assistant';

// 선택 가능한 모델 목록.
const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8'];
// 생각의 깊이 옵션.
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

export function WorkspaceAssistantCard() {
  const { data } = useWorkspaceAssistant();
  const { data: agents } = useAgents();
  const setAssistant = useSetWorkspaceAssistant();
  const updateSettings = useUpdateWorkspaceAssistantSettings();

  // 모델 변경 — 실패 시 오류 토스트(silent failure 방지), 성공 시 확인 토스트.
  const handleModelChange = async (model: string) => {
    try {
      await updateSettings.mutateAsync({ model });
      toast.success('공용 비서 설정을 변경했어요.');
    } catch (e) {
      handleApiError(e, '공용 비서 설정 변경에 실패했어요.');
    }
  };

  // 생각의 깊이 변경 — 실패 시 오류 토스트, 성공 시 확인 토스트.
  const handleDepthChange = async (thinkingDepth: ThinkingDepth) => {
    try {
      await updateSettings.mutateAsync({ thinkingDepth });
      toast.success('공용 비서 설정을 변경했어요.');
    } catch (e) {
      handleApiError(e, '공용 비서 설정 변경에 실패했어요.');
    }
  };

  return (
    <Card data-testid="workspace-assistant-card">
      <CardHeader>
        <CardTitle>공용 비서</CardTitle>
        <CardDescription>홈을 기본으로 담당하는 워크스페이스 비서예요.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 담당 AGENT 지정 */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="workspace-assistant-agent">
            담당 AGENT
          </label>
          <select
            id="workspace-assistant-agent"
            data-testid="workspace-assistant-agent"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={data?.agentUserId ?? ''}
            onChange={(e) => setAssistant.mutate(Number(e.target.value))}
          >
            <option value="" disabled>
              선택…
            </option>
            {(agents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        {/* 지정된 비서에 활성 토큰이 없으면 경고 */}
        {data?.agentUserId && !data.hasActiveToken ? (
          <div
            data-testid="workspace-assistant-warn"
            className="text-sm text-amber-600"
          >
            지정된 비서에 활성 토큰이 없어요. OAuth 토큰을 등록해야 홈이 동작해요.
          </div>
        ) : null}

        {/* 지정된 경우에만 모델 / 생각의 깊이 설정 노출 */}
        {data?.agentUserId ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                className="text-sm font-medium"
                htmlFor="workspace-assistant-model"
              >
                모델
              </label>
              <select
                id="workspace-assistant-model"
                data-testid="workspace-assistant-model"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={data.model ?? ''}
                onChange={(e) => handleModelChange(e.target.value)}
              >
                <option value="" disabled>
                  선택…
                </option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label
                className="text-sm font-medium"
                htmlFor="workspace-assistant-depth"
              >
                생각의 깊이
              </label>
              <select
                id="workspace-assistant-depth"
                data-testid="workspace-assistant-depth"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={data.thinkingDepth ?? 'NORMAL'}
                onChange={(e) =>
                  handleDepthChange(e.target.value as ThinkingDepth)
                }
              >
                {DEPTHS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
