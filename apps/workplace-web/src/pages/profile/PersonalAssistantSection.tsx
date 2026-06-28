// 프로필 "개인 비서" 섹션 — 본인 Claude OAuth 토큰 등록/교체, 모델·생각의 깊이 변경, 해제.
// 토큰은 사용자가 직접 입력한다(자동 채움 금지). 평문 토큰은 등록 시점에만 전송하고 즉시 비운다.

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  useDisableMyAssistant,
  useMyAssistant,
  useRegisterMyAssistantToken,
  useUpdateMyAssistantSettings,
} from '../../hooks/queries/useAssistant';
import { handleApiError } from '../../lib/api-error';
import { MODEL_OPTIONS } from '../../lib/assistant-models';
import type { ThinkingDepth } from '../../types/assistant';

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
      toast.error('토큰 형식이 올바르지 않습니다.');
      return;
    }
    try {
      await register.mutateAsync({ token: t });
      setToken('');
      toast.success('개인 비서 토큰을 저장했습니다.');
    } catch (e) {
      handleApiError(e, '토큰 등록에 실패했습니다.');
    }
  };

  // 모델 변경 — 실패 시 오류 토스트(silent failure 방지), 성공 시 확인 토스트.
  const handleModelChange = async (model: string) => {
    try {
      await updateSettings.mutateAsync({ model });
      toast.success('비서 설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '비서 설정 변경에 실패했습니다.');
    }
  };

  // 생각의 깊이 변경 — 실패 시 오류 토스트, 성공 시 확인 토스트.
  const handleDepthChange = async (thinkingDepth: ThinkingDepth) => {
    try {
      await updateSettings.mutateAsync({ thinkingDepth });
      toast.success('비서 설정을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '비서 설정 변경에 실패했습니다.');
    }
  };

  // 개인 비서 해제.
  const handleDisable = async () => {
    try {
      await disable.mutateAsync();
      toast.success('개인 비서를 해제했습니다.');
    } catch (e) {
      handleApiError(e, '개인 비서 해제에 실패했습니다.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>개인 비서</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          개인 비서를 설정하면 홈을 공통 비서 대신 내 비서가 담당해요.
        </p>

        {status?.configured ? (
          <div className="space-y-4">
            {/* 설정됨 — 토큰 라벨(없으면 생략)/모델/생각의 깊이/해제 */}
            <p className="text-sm" data-testid="assistant-configured">
              설정됨{status.tokenLabel ? ` · ${status.tokenLabel}` : ''}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assistant-model">
                모델
              </label>
              {/* 앱 디자인 시스템 일관성 — shadcn Select 사용 (native <select> 금지) */}
              <Select value={status.model ?? ''} onValueChange={handleModelChange}>
                <SelectTrigger id="assistant-model">
                  <SelectValue />
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

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assistant-depth">
                생각의 깊이
              </label>
              {/* 앱 디자인 시스템 일관성 — shadcn Select 사용 (native <select> 금지) */}
              <Select
                value={status.thinkingDepth ?? 'NORMAL'}
                onValueChange={(v) => handleDepthChange(v as ThinkingDepth)}
              >
                <SelectTrigger id="assistant-depth">
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
