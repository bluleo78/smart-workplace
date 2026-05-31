// 프로필 "개인 비서" 섹션 — 본인 Claude OAuth 토큰 등록/교체, 모델·생각의 깊이 변경, 해제.
// 토큰은 사용자가 직접 입력한다(자동 채움 금지). 평문 토큰은 등록 시점에만 전송하고 즉시 비운다.

import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDisableMyAssistant,
  useMyAssistant,
  useRegisterMyAssistantToken,
  useUpdateMyAssistantSettings,
} from '../../hooks/queries/useAssistant';
import type { ThinkingDepth } from '../../types/assistant';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

// 선택 가능한 모델 목록.
const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8'];
// 생각의 깊이 옵션.
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

export function PersonalAssistantSection() {
  // 훅은 컴포넌트 최상위에서만 호출 — 핸들러 안에서 호출 금지.
  const { data: status } = useMyAssistant();
  const register = useRegisterMyAssistantToken();
  const updateSettings = useUpdateMyAssistantSettings();
  const disable = useDisableMyAssistant();
  const [token, setToken] = useState('');

  // 토큰 등록 — 형식(최소 32자) 검증 후 평문 전송, 성공 시 입력 비움.
  const submitToken = async () => {
    const t = token.trim();
    if (t.length < 32) {
      toast.error('토큰 형식이 올바르지 않아요.');
      return;
    }
    await register.mutateAsync({ token: t });
    setToken('');
    toast.success('개인 비서 토큰을 저장했어요.');
  };

  // 개인 비서 해제.
  const handleDisable = async () => {
    await disable.mutateAsync();
    toast.success('개인 비서를 해제했어요.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>개인 비서</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          개인 비서를 설정하면 홈을 공용 비서 대신 내 비서가 담당해요.
        </p>

        {status?.configured ? (
          <div className="space-y-4">
            {/* 설정됨 — 토큰 라벨/모델/생각의 깊이/해제 */}
            <p className="text-sm" data-testid="assistant-configured">
              설정됨 · 토큰 {status.tokenLabel ?? '(라벨 없음)'}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assistant-model">
                모델
              </label>
              <select
                id="assistant-model"
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={status.model ?? ''}
                onChange={(e) => updateSettings.mutate({ model: e.target.value })}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assistant-depth">
                생각의 깊이
              </label>
              <select
                id="assistant-depth"
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={status.thinkingDepth ?? 'NORMAL'}
                onChange={(e) =>
                  updateSettings.mutate({ thinkingDepth: e.target.value as ThinkingDepth })
                }
              >
                {DEPTHS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <Button variant="destructive" onClick={handleDisable}>
              해제
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 미설정 — 본인이 직접 토큰을 입력해 등록 */}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assistant-token-input">
                Claude OAuth 토큰
              </label>
              <Input
                id="assistant-token-input"
                data-testid="assistant-token-input"
                type="password"
                placeholder="sk-ant-oat-..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <Button onClick={submitToken}>토큰 등록</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
