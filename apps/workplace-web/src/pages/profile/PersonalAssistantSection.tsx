// 프로필 "개인 비서" 섹션 — 본인 자격증명(Claude 구독 OAuth 또는 opencode 외부 프로바이더) 등록/교체,
// 모델·생각의 깊이 변경, 해제.
// 미설정 상태의 등록 폼은 admin ProviderCredentialDialog(Task 12)와 동일한 2모드 UX를 따른다.
// - anthropic: 토큰을 직접 입력한다(자동 채움 금지). 평문 토큰은 등록 시점에만 전송하고 즉시 비운다.
// - opencode: 프리셋 선택 → baseURL/apiKey 입력 → 모델 프로브(실패 시 수동 입력 폴백) → 등록.
// 별도 다이얼로그가 아닌 카드 내 인라인 폼으로 둔다 — 소비처가 1곳뿐이라 다이얼로그 추출은 과설계(YAGNI).

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { probeMyAssistantModels } from '../../api/models';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PasswordInput } from '../../components/ui/password-input';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
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
  useMyAssistantModels,
  useRegisterMyAssistantCredential,
  useUpdateMyAssistantName,
  useUpdateMyAssistantSettings,
} from '../../hooks/queries/useAssistant';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import { OPENCODE_PRESETS, type OpencodePresetKey } from '../../lib/opencode-presets';
import type { ThinkingDepth } from '../../types/assistant';
import type { CredentialProvider, ModelOption } from '../../types/providerCredential';

// 생각의 깊이 옵션.
const DEPTHS: { value: ThinkingDepth; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'NORMAL', label: '보통' },
  { value: 'DEEP', label: '깊게' },
];

export function PersonalAssistantSection() {
  // 훅은 컴포넌트 최상위에서만 호출 — 핸들러 안에서 호출 금지.
  // 비서 가용성(aiAvailable) 변경 시 AuthContext user 캐시를 즉시 갱신해 페이지 새로고침 없이 반영.
  const { refreshUser } = useAuth();
  const { data: status } = useMyAssistant();
  const register = useRegisterMyAssistantCredential();
  const updateSettings = useUpdateMyAssistantSettings();
  const updateName = useUpdateMyAssistantName();
  const disable = useDisableMyAssistant();
  // 설정된 비서의 모델 목록 — 저장된 자격증명 기준 서버 조회(미설정이면 비활성화).
  const { data: modelsData, isLoading: modelsLoading } = useMyAssistantModels(
    status?.configured === true,
  );
  const modelOptions = modelsData?.models ?? [];

  // 등록 폼 — 연결 방식.
  const [connectionType, setConnectionType] = useState<CredentialProvider>('anthropic');

  // anthropic 입력.
  const [token, setToken] = useState('');

  // opencode 입력.
  const [presetKey, setPresetKey] = useState<OpencodePresetKey>('amazon-bedrock-openai');
  const [baseUrl, setBaseUrl] = useState<string>(OPENCODE_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [probedModels, setProbedModels] = useState<ModelOption[] | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [manualModel, setManualModel] = useState('');

  // 공통.
  const [label, setLabel] = useState('');

  // 이름 편집 draft — null 이면 서버값을 그대로 표시(미편집), 입력 시작 시 draft 로 전환.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameValue = nameDraft ?? status?.name ?? '';

  const probe = useMutation({
    mutationFn: () =>
      probeMyAssistantModels({
        providerConfig: { providerId: presetKey, options: { baseURL: baseUrl.trim(), apiKey } },
      }),
  });

  const resetForm = () => {
    setConnectionType('anthropic');
    setToken('');
    setPresetKey('amazon-bedrock-openai');
    setBaseUrl(OPENCODE_PRESETS[0].baseUrl);
    setApiKey('');
    setProbedModels(null);
    setProbeError(null);
    setSelectedModel('');
    setManualModel('');
    setLabel('');
  };

  // 프리셋 변경 시 baseURL 템플릿 자동 채움 + 이전 프로브 결과 초기화.
  const onPresetChange = (key: OpencodePresetKey) => {
    setPresetKey(key);
    const preset = OPENCODE_PRESETS.find((p) => p.key === key);
    setBaseUrl(preset?.baseUrl ?? '');
    setProbedModels(null);
    setProbeError(null);
    setSelectedModel('');
    setManualModel('');
  };

  // 모델 목록 프로브 — 성공 시 모델 Select 노출, 실패 시 수동 입력 폴백 노출.
  const onProbeModels = async () => {
    setProbeError(null);
    setProbedModels(null);
    setSelectedModel('');
    try {
      const res = await probe.mutateAsync();
      setProbedModels(res.models);
    } catch (e) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        '모델 목록을 불러오지 못했습니다. 모델 id를 직접 입력하세요.';
      setProbeError(message);
    }
  };

  const resolvedModel = selectedModel || manualModel.trim();

  // 자격증명 등록 — anthropic(토큰 최소 32자)/opencode(모델 필수) 공통 진입점.
  const submitCredential = async () => {
    if (connectionType === 'anthropic') {
      const trimmed = token.trim();
      // 백엔드 검증과 정합 (@Size(min = 32)) — 기존 문구 유지(회귀 방지).
      if (trimmed.length < 32) {
        toast.error('토큰 형식이 올바르지 않습니다.');
        return;
      }
      try {
        await register.mutateAsync({ provider: 'anthropic', token: trimmed, label: label.trim() || undefined });
        resetForm();
        toast.success('개인 비서 토큰을 저장했습니다.');
        void refreshUser();
      } catch (e) {
        handleApiError(e, '토큰 등록에 실패했습니다.');
      }
      return;
    }

    // opencode — model 미선택 시 제출 차단.
    if (!resolvedModel) {
      toast.error('모델을 선택하거나 직접 입력하세요.');
      return;
    }
    try {
      await register.mutateAsync({
        provider: 'opencode',
        providerConfig: { providerId: presetKey, options: { baseURL: baseUrl.trim(), apiKey } },
        model: resolvedModel,
        label: label.trim() || undefined,
      });
      resetForm();
      toast.success('개인 비서를 등록했습니다.');
      void refreshUser();
    } catch (e) {
      handleApiError(e, '등록에 실패했습니다.');
    }
  };

  const submitDisabled = register.isPending || (connectionType === 'opencode' && !resolvedModel);

  // 이름 변경 — 명시적 저장(키 입력마다 PUT 금지). 빈값 거부, 성공 시 서버값으로 재동기화.
  const handleNameSave = async () => {
    const trimmed = nameValue.trim();
    if (trimmed.length === 0) {
      toast.error('이름을 입력해주세요.');
      return;
    }
    try {
      await updateName.mutateAsync(trimmed);
      setNameDraft(null);
      toast.success('개인 비서 이름을 변경했습니다.');
    } catch (e) {
      handleApiError(e, '이름 변경에 실패했습니다.');
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

  // 개인 비서 해제 — 성공 시 user 갱신(aiAvailable false 로 즉시 반영).
  const handleDisable = async () => {
    try {
      await disable.mutateAsync();
      toast.success('개인 비서를 해제했습니다.');
      void refreshUser();
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
              <label className="text-sm font-medium" htmlFor="assistant-name">
                이름
              </label>
              {/* 명시적 저장 — 입력 후 저장 버튼을 눌러야 반영(키 입력마다 PUT 방지). */}
              <div className="flex gap-2">
                <Input
                  id="assistant-name"
                  data-testid="assistant-name-input"
                  value={nameValue}
                  maxLength={50}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
                <Button
                  onClick={handleNameSave}
                  disabled={
                    updateName.isPending ||
                    nameValue.trim().length === 0 ||
                    nameValue.trim() === (status.name ?? '')
                  }
                  data-testid="assistant-name-save"
                >
                  저장
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="assistant-model">
                모델
              </label>
              {/* 앱 디자인 시스템 일관성 — shadcn Select 사용 (native <select> 금지). 모델 목록은 서버 조회. */}
              <Select
                value={status.model ?? ''}
                onValueChange={handleModelChange}
                disabled={modelsLoading || modelOptions.length === 0}
              >
                <SelectTrigger id="assistant-model" data-testid="assistant-model">
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
                  data-testid="assistant-model-empty"
                  className="text-xs text-muted-foreground"
                >
                  사용 가능한 모델이 없어요 — 자격증명이 등록됐는지, 프로바이더 연결이 정상인지
                  확인하세요.
                </p>
              ) : null}
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
            {/* 미설정 — 연결 방식 선택 후 등록 */}
            <div className="space-y-1.5">
              <Label>연결 방식</Label>
              <RadioGroup
                value={connectionType}
                onValueChange={(v) => setConnectionType(v as CredentialProvider)}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <Label
                  htmlFor="credential-provider-anthropic"
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-normal has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem
                    id="credential-provider-anthropic"
                    value="anthropic"
                    data-testid="credential-provider-anthropic"
                  />
                  Claude 구독 (OAuth 토큰)
                </Label>
                <Label
                  htmlFor="credential-provider-opencode"
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-normal has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem
                    id="credential-provider-opencode"
                    value="opencode"
                    data-testid="credential-provider-opencode"
                  />
                  외부 프로바이더 (OpenAI 호환)
                </Label>
              </RadioGroup>
            </div>

            {connectionType === 'anthropic' ? (
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
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="credential-preset">프리셋</Label>
                  <Select
                    value={presetKey}
                    onValueChange={(v) => onPresetChange(v as OpencodePresetKey)}
                  >
                    <SelectTrigger id="credential-preset" data-testid="credential-preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPENCODE_PRESETS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="credential-base-url">Base URL</Label>
                  <Input
                    id="credential-base-url"
                    data-testid="credential-base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="credential-api-key">API Key</Label>
                  <PasswordInput
                    id="credential-api-key"
                    data-testid="credential-api-key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onProbeModels()}
                  disabled={probe.isPending || !baseUrl.trim() || !apiKey}
                  data-testid="credential-probe-models"
                >
                  {probe.isPending ? '불러오는 중…' : '모델 불러오기'}
                </Button>

                {probedModels != null ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="credential-model-select">모델</Label>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger
                        id="credential-model-select"
                        data-testid="credential-model-select"
                      >
                        <SelectValue placeholder="선택…" />
                      </SelectTrigger>
                      <SelectContent>
                        {probedModels.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {probeError ? (
                  <div className="space-y-1.5">
                    <p className="text-sm text-destructive">{probeError}</p>
                    <Label htmlFor="credential-model-manual">모델 id (직접 입력)</Label>
                    <Input
                      id="credential-model-manual"
                      data-testid="credential-model-manual"
                      value={manualModel}
                      onChange={(e) => setManualModel(e.target.value)}
                      placeholder="providerId/model-id"
                      autoComplete="off"
                    />
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="credential-label">레이블 (선택)</Label>
              <Input
                id="credential-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="main"
                maxLength={80}
              />
            </div>

            <Button onClick={() => void submitCredential()} disabled={submitDisabled}>
              {register.isPending ? '저장 중…' : '등록'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
