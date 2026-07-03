// AGENT 프로바이더 자격증명 등록/재발급 다이얼로그.
// 두 가지 연결 방식을 지원한다.
// - anthropic: 호스트의 `claude setup-token` 으로 발급한 OAuth 토큰을 붙여넣는다.
// - opencode: OpenAI 호환 엔드포인트(AWS Bedrock/OpenAI/Gemini/직접 입력) — baseURL+apiKey 로
//   모델 목록을 프로브한 뒤 모델을 선택(또는 프로브 실패 시 수동 입력)해 등록한다.
// 저장 후 평문(토큰/apiKey)은 다시 표시되지 않으며, 재발급 시 기존 active 자격증명은 자동 회수된다.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { probeAgentModels } from '@/api/models';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useRegisterAgentProviderCredential } from '@/hooks/queries/useAgentProviderCredential';
import { handleApiError } from '@/lib/api-error';
import { OPENCODE_PRESETS, type OpencodePresetKey } from '@/lib/opencode-presets';
import type { CredentialProvider, ModelOption } from '@/types/providerCredential';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentUserId: number;
  isReissue: boolean;
}

type PresetKey = OpencodePresetKey;

// 입력 → 길이 검증 → mutate → toast → 다이얼로그 닫기.
export function ProviderCredentialDialog({
  open,
  onOpenChange,
  agentUserId,
  isReissue,
}: Props) {
  const [connectionType, setConnectionType] = useState<CredentialProvider>('anthropic');

  // anthropic 입력.
  const [token, setToken] = useState('');

  // opencode 입력.
  const [presetKey, setPresetKey] = useState<PresetKey>('amazon-bedrock-openai');
  const [baseUrl, setBaseUrl] = useState<string>(OPENCODE_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[] | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [manualModel, setManualModel] = useState('');

  // 공통.
  const [label, setLabel] = useState('');

  const mutation = useRegisterAgentProviderCredential(agentUserId);
  const probe = useMutation({
    mutationFn: () =>
      probeAgentModels({
        providerConfig: { providerId: presetKey, options: { baseURL: baseUrl.trim(), apiKey } },
      }),
  });

  const reset = () => {
    setConnectionType('anthropic');
    setToken('');
    setPresetKey('amazon-bedrock-openai');
    setBaseUrl(OPENCODE_PRESETS[0].baseUrl);
    setApiKey('');
    setModelOptions(null);
    setProbeError(null);
    setSelectedModel('');
    setManualModel('');
    setLabel('');
  };

  // 프리셋 변경 시 baseURL 템플릿 자동 채움 + 이전 프로브 결과 초기화.
  const onPresetChange = (key: PresetKey) => {
    setPresetKey(key);
    const preset = OPENCODE_PRESETS.find((p) => p.key === key);
    setBaseUrl(preset?.baseUrl ?? '');
    setModelOptions(null);
    setProbeError(null);
    setSelectedModel('');
    setManualModel('');
  };

  // 모델 목록 프로브 — 성공 시 모델 Select 노출, 실패 시 수동 입력 폴백 노출.
  const onProbeModels = async () => {
    setProbeError(null);
    setModelOptions(null);
    setSelectedModel('');
    try {
      const res = await probe.mutateAsync();
      setModelOptions(res.models);
    } catch (e) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        '모델 목록을 불러오지 못했습니다. 모델 id를 직접 입력하세요.';
      setProbeError(message);
    }
  };

  // 수동 입력 모델 id 에 providerId/ 접두어가 없으면 자동으로 붙인다 — 실측 함정(접두 없이 저장 →
  // splitOpencodeModel 실행 시점 실패) 방지. presetKey 는 제출과 함께 전송되는
  // providerConfig.providerId 와 항상 동일하므로 추측이 아니라 정확한 값이다.
  const rawManualModel = manualModel.trim();
  const normalizedManualModel =
    rawManualModel && !rawManualModel.includes('/') ? `${presetKey}/${rawManualModel}` : rawManualModel;
  const resolvedModel = selectedModel || normalizedManualModel;

  const submit = async () => {
    if (connectionType === 'anthropic') {
      const trimmed = token.trim();
      // 백엔드 검증과 정합 (@Size(min = 32))
      if (trimmed.length < 32) {
        toast.error('토큰이 너무 짧습니다 (최소 32자)');
        return;
      }
      try {
        await mutation.mutateAsync({
          provider: 'anthropic',
          token: trimmed,
          label: label.trim() || undefined,
        });
        toast.success(isReissue ? '자격증명을 재발급했습니다.' : '자격증명을 등록했습니다.');
        reset();
        onOpenChange(false);
      } catch (e) {
        handleApiError(e, '등록에 실패했습니다');
      }
      return;
    }

    // opencode — model 미선택 시 제출 차단.
    if (!resolvedModel) {
      toast.error('모델을 선택하거나 직접 입력하세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        provider: 'opencode',
        providerConfig: { providerId: presetKey, options: { baseURL: baseUrl.trim(), apiKey } },
        model: resolvedModel,
        label: label.trim() || undefined,
      });
      toast.success(isReissue ? '자격증명을 재발급했습니다.' : '자격증명을 등록했습니다.');
      reset();
      onOpenChange(false);
    } catch (e) {
      handleApiError(e, '등록에 실패했습니다');
    }
  };

  const submitDisabled =
    mutation.isPending || (connectionType === 'opencode' && !resolvedModel);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isReissue ? '자격증명 재발급' : '자격증명 등록'}</DialogTitle>
          <DialogDescription>
            에이전트가 LLM을 호출할 자격증명을 등록합니다. 저장 후 평문(토큰/API 키)은 다시
            표시되지 않습니다.
            {isReissue ? ' 기존 자격증명은 자동으로 회수됩니다.' : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
            <div className="space-y-1.5">
              <Label htmlFor="oauth-token">토큰</Label>
              <Textarea
                id="oauth-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sk-ant-oat..."
                className="font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                rows={4}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="credential-preset">프리셋</Label>
                <Select value={presetKey} onValueChange={(v) => onPresetChange(v as PresetKey)}>
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

              {modelOptions != null ? (
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
                      {modelOptions.map((m) => (
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
                    placeholder={`${presetKey}/model-id`}
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={submitDisabled}>
            {mutation.isPending ? '저장 중…' : isReissue ? '재발급' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
