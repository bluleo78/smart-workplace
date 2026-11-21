// AGENT 프로바이더 API 키(토큰) 등록/재발급 다이얼로그.
// 두 가지 연결 방식을 지원한다.
// - anthropic: 호스트의 `claude setup-token` 으로 발급한 OAuth 토큰을 붙여넣는다.
// - opencode: OpenAI 호환 엔드포인트(AWS Bedrock/OpenAI/Gemini/직접 입력) — baseURL+apiKey 로
//   모델 목록을 프로브한 뒤 모델을 선택(또는 프로브 실패 시 수동 입력)해 등록한다.
// 저장 후 평문(토큰/apiKey)은 다시 표시되지 않으며, 재발급 시 기존 active API 키는 자동 회수된다.
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { probeAgentModels } from '@/api/models';
import { VisionInputSelect } from '@/components/ai/VisionInputSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useRegisterAgentProviderCredential } from '@/hooks/queries/useAgentProviderCredential';
import { useModelProbe } from '@/hooks/useModelProbe';
import { useModelVisionChoice } from '@/hooks/useModelVisionChoice';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';
import { withProviderPrefix } from '@/lib/ai/suggestionModel';
import { visionConfigFor } from '@/lib/ai/visionConfig';
import { useAnthropicWorkspaceId } from '@/lib/anthropicWorkspaceId';
import { handleApiError } from '@/lib/api-error';
import { type OpencodePresetKey, toOpencodeProviderConfig } from '@/lib/opencode-presets';
import { PROBE_MODELS_EMPTY } from '@/lib/probeModelsError';
import type { CredentialProvider } from '@/types/providerCredential';

import { AnthropicWorkspaceIdField } from './credential-fields/AnthropicWorkspaceIdField';
import { CLAUDE_TOKEN_MAX, CLAUDE_TOKEN_MIN, ClaudeTokenField } from './credential-fields/ClaudeTokenField';
import {
  DEFAULT_OPENCODE_BASE_URL,
  DEFAULT_OPENCODE_PRESET,
  OpencodeConnectionFields,
} from './credential-fields/OpencodeConnectionFields';

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
  // WP-1496: Anthropic 워크스페이스 ID(선택) — 형식 오류·서버 거절 안내는 칸 아래에 보이고, 서버 거절이면 이 칸으로 초점을 옮긴다.
  const workspace = useAnthropicWorkspaceId();

  // opencode 입력.
  const [presetKey, setPresetKey] = useState<PresetKey>(DEFAULT_OPENCODE_PRESET);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_OPENCODE_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [manualModel, setManualModel] = useState('');
  // 수동 입력 모델 id 에 providerId/ 접두어가 없으면 자동으로 붙인다 — 실측 함정(접두 없이 저장 →
  // splitOpencodeModel 실행 시점 실패) 방지. presetKey 는 제출과 함께 전송되는
  // providerConfig.providerId 와 항상 동일하므로 추측이 아니라 정확한 값이다.
  const normalizedManualModel = withProviderPrefix(manualModel, presetKey);
  const resolvedModel = selectedModel || normalizedManualModel;
  // 이미지 입력 수동 지정 — 'auto' 면 providerConfig.vision 을 보내지 않는다. 선택은 그때의 모델 id 에만 적용되어,
  // 모델을 바꾸면(직접 입력 중 다른 id 가 되면) 자동 감지로 보인다. 키를 칠 때마다 지우지 않으므로 같은 id 로 정리되는 입력엔 유지된다.
  const { vision, setVision, resetVision } = useModelVisionChoice(resolvedModel);

  const mutation = useRegisterAgentProviderCredential(agentUserId);
  // 「모델 불러오기」 — 요청 끊기·늦은 응답 버리기·진행 표시는 공용 훅이 맡는다(WP-1900). 연결이 바뀌면 clear 를 부른다.
  const probe = useModelProbe((signal) =>
    probeAgentModels({ providerConfig: toOpencodeProviderConfig(presetKey, baseUrl, apiKey) }, signal),
  );
  // 직접 입력 칸의 안내 — 있으면 칸을 보인다. 프로브 실패, 또는 성공했지만 목록이 빈 경우(빈 Select 로는 고를 수 없다, WP-1895) —
  // 두 조건 모두 공용 훅의 결과(probe.models·probe.error) 기준이다(WP-1900).
  const manualNotice = probe.error ?? (probe.models?.length === 0 ? PROBE_MODELS_EMPTY : null);

  /**
   * 불러온 모델 목록·고른 모델·직접 입력한 모델·불러오기 오류를 비운다(WP-1622).
   * 왜: 모델 목록은 그때의 주소·키로 받은 것이라, 주소나 키를 고친 뒤에도 남아 있으면 Enter 한 번으로
   *     「주소 B + 주소 A 에서 고른 모델」이 저장된다. 주소·키·프리셋이 바뀌면 모델을 다시 불러오게 한다.
   */
  const clearLoadedModels = () => {
    probe.clear();
    setSelectedModel('');
    setManualModel('');
    resetVision();
  };

  const reset = () => {
    setConnectionType('anthropic');
    setToken('');
    workspace.reset();
    setPresetKey(DEFAULT_OPENCODE_PRESET);
    setBaseUrl(DEFAULT_OPENCODE_BASE_URL);
    setApiKey('');
    clearLoadedModels();
  };

  /**
   * 닫기 공통 경로 — Radix 의 닫힘(오버레이·ESC·닫기 단추)과 푸터 [취소] 단추가 모두 이 함수를 거치게 한다(WP-1900).
   * 왜: 대화상자는 닫혀도 숨겨질 뿐 언마운트되지 않아, [취소] 만 reset 을 건너뛰면 불러오는 중에 닫은 뒤 다시 열었을 때
   *   옛 목록·오류·「불러오는 중…」이 그대로 남는다.
   */
  const requestClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  /**
   * 연결 칸 하나(프리셋·주소·키·연결 종류)를 바꾸고 불러온 모델 상태를 비운다(WP-1622·WP-1900) — 앞서 불러온 모델은 지금 연결의 것이 아니다.
   * 칸마다 같은 두 줄(값 바꾸기 + clearLoadedModels)을 되풀이하지 않게 한 곳에 둔다(계정 창의 resettingProbe 와 같은 뜻).
   * 커링(setter 를 감싼 함수를 렌더 중에 만들기)으로 쓰면 React Compiler 린트(react-hooks/refs)가 렌더 중 ref 접근으로 보아,
   * 칸의 onChange 안에서 (setter, 값) 으로 부른다. 프리셋을 바꿀 때 baseURL 템플릿은 OpencodeConnectionFields 가 채운다.
   */
  const setClearingModels = <T,>(set: (v: T) => void, v: T) => {
    set(v);
    clearLoadedModels();
  };

  // 모델 목록 프로브 — 성공·목록 있음 → Select 노출, 실패 또는 빈 목록 → 수동 입력 폴백 노출(WP-1895).
  const onProbeModels = async () => {
    setSelectedModel('');
    resetVision();
    // 목록이 있어(빈 목록이 아닐 때) Select 가 직접 입력 칸을 대체하므로 그때만 비운다 — 목록이 보이는데 숨은 칸의 값이
    // 남아 resolvedModel 로 보내지는 것을 막는다(WP-1622·WP-1895). 끊기거나 실패·빈 목록이면 입력을 그대로 둔다.
    const loadedModels = await probe.load();
    if (loadedModels && loadedModels.length > 0) setManualModel('');
  };

  const visionConfig = visionConfigFor(vision, resolvedModel);

  // [연결하기] 단추의 비활성 조건 — Enter 제출도 같은 조건을 지키도록 submit 맨 앞에서 함께 쓴다(WP-1622).
  // 「모델 불러오기」 중에는 모델이 곧 바뀌므로(목록 도착·오류) 그동안은 보내지 않는다.
  const submitDisabled =
    mutation.isPending || (connectionType === 'opencode' && (probe.isLoading || !resolvedModel));
  // 요청 진행 중 표시(WP-1622) — isPending 은 다음 렌더에야 바뀌므로 같은 틱에 두 번 제출(Enter 자동 반복·Enter 뒤 클릭)되면
  // 둘 다 submitDisabled 를 통과한다. ref 는 즉시 바뀌어 두 번째 제출을 막는다.
  const inFlight = useRef(false);
  // 한 줄 칸(워크스페이스 ID·Base URL·API Key·모델 id) Enter 공용 처리(WP-331) — 한글 조합 Enter·macOS Chrome 꼬리 Enter 는 제출로 보지 않는다.
  const enterKey = useSingleLineEnter();

  const submit = async () => {
    // Enter 로 제출할 때도 단추와 같은 조건(처리 중·모델 불러오는 중·opencode 모델 미정)을 지키고, 같은 틱 이중 제출을 막는다.
    if (submitDisabled || inFlight.current) return;
    // 검사 앞에서 건다 — 같은 틱 두 번째 제출이 검사 토스트(짧은 토큰 등)를 겹쳐 띄우지 않게. 검사에서 돌아가도 finally 가 푼다.
    inFlight.current = true;
    try {
      await send();
    } finally {
      inFlight.current = false;
    }
  };

  /** 입력 검사 → 등록 요청 → 알림·닫기. 진행 중 가드는 submit 이 건다. */
  const send = async () => {
    if (connectionType === 'anthropic') {
      const trimmed = token.trim();
      // 백엔드 검증과 정합 (@Size(min = 32, max = 2048)) — 계정 창과 같은 상수. 넘거나 모자라면 보내도 400 이라 미리 알린다.
      if (trimmed.length < CLAUDE_TOKEN_MIN) {
        toast.error(`토큰이 너무 짧습니다 (최소 ${CLAUDE_TOKEN_MIN}자)`);
        return;
      }
      if (trimmed.length > CLAUDE_TOKEN_MAX) {
        toast.error(`토큰이 너무 깁니다 (최대 ${CLAUDE_TOKEN_MAX}자)`);
        return;
      }
      // 워크스페이스 ID 형식(공백·제어 문자 없음, 128자 이하) — 틀리면 칸 아래에 알리고 보내지 않는다.
      if (!workspace.validate()) return;
      try {
        await mutation.mutateAsync({
          provider: 'anthropic',
          token: trimmed,
          ...workspace.part(),
        });
        toast.success(isReissue ? '연결 정보를 변경했습니다.' : 'AI에 연결했습니다.');
        reset();
        onOpenChange(false);
      } catch (e) {
        // 서버가 「이 키는 워크스페이스 ID 가 필요하다」고 거절하면 창과 토큰은 그대로 두고 ID 칸에서 바로 고치게 한다.
        if (workspace.absorbApiError(e)) return;
        handleApiError(e, '연결에 실패했습니다');
      }
      return;
    }

    // opencode — 모델 미정은 submitDisabled 가 이미 막는다.
    try {
      await mutation.mutateAsync({
        provider: 'opencode',
        providerConfig: {
          ...toOpencodeProviderConfig(presetKey, baseUrl, apiKey),
          // 수동 지정일 때만 { [최종 모델 id]: true|false } — 자동이면 키 생략.
          ...(visionConfig ? { vision: visionConfig } : {}),
        },
        model: resolvedModel,
      });
      toast.success(isReissue ? '연결 정보를 변경했습니다.' : 'AI에 연결했습니다.');
      reset();
      onOpenChange(false);
    } catch (e) {
      handleApiError(e, '연결에 실패했습니다');
    }
  };

  /** 한 줄 칸 Enter → 제출(WP-1622). 조건 검사는 submit 이 단추와 같은 기준으로 한다. */
  const submitOnEnter = () => void submit();

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      {/* 「AI 계정을 연결한다」 도움말 절(WP-1507) — 열린 대화상자가 포커스보다 앞서므로 안쪽 칸에는 따로 달지 않는다. */}
      <DialogContent data-help="agent.run.account">
        <DialogHeader>
          <DialogTitle>{isReissue ? '연결 정보 변경' : 'AI 연결하기'}</DialogTitle>
          <DialogDescription>
            에이전트가 LLM을 호출할 연결 정보를 입력하세요. 저장 후 입력한 값은 다시
            표시되지 않습니다.
            {isReissue ? ' 기존 연결은 자동으로 해제됩니다.' : null}
          </DialogDescription>
        </DialogHeader>
        {/* min-h — 연결 방식(anthropic↔opencode)·프로브 결과 유무에 따라 내용 길이가 크게 달라져
            다이얼로그가 열릴 때마다 세로 크기가 요동치는 것을 막기 위해 가장 긴 상태(opencode +
            모델 목록 노출) 기준으로 최소 높이를 예약한다. */}
        <div className="space-y-4 min-h-[420px]">
          <div className="space-y-1.5">
            <Label>연결 방식</Label>
            {/* 연결 종류를 바꿔도 프로브 결과만 비우면 고른 모델이 남아 화면에 없는 모델로 연결된다 — 개인 비서와 같은 뜻(WP-1900 리뷰 반려 ②). */}
            <RadioGroup
              value={connectionType}
              onValueChange={(v) => setClearingModels(setConnectionType, v as CredentialProvider)}
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
                Claude 구독
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
                OpenAI 호환
              </Label>
            </RadioGroup>
          </div>

          {connectionType === 'anthropic' ? (
            <>
              <ClaudeTokenField value={token} onChange={setToken} />
              <AnthropicWorkspaceIdField {...workspace.fieldProps} onEnter={submitOnEnter} />
            </>
          ) : (
            <div className="space-y-3">
              <OpencodeConnectionFields
                presetKey={presetKey}
                onPresetChange={(v) => setClearingModels(setPresetKey, v)}
                baseUrl={baseUrl}
                onBaseUrlChange={(v) => setClearingModels(setBaseUrl, v)}
                apiKey={apiKey}
                onApiKeyChange={(v) => setClearingModels(setApiKey, v)}
                onEnter={submitOnEnter}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onProbeModels()}
                disabled={probe.isLoading || !baseUrl.trim() || !apiKey}
                data-testid="credential-probe-models"
              >
                {probe.isLoading ? '불러오는 중…' : '모델 불러오기'}
              </Button>

              {/* 목록이 있어야 Select 로 고를 수 있다 — 빈 목록이면 아래 직접 입력 폴백으로(WP-1895). */}
              {probe.models != null && probe.models.length > 0 ? (
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
                      {probe.models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {manualNotice ? (
                <div className="space-y-1.5">
                  <p role="alert" className="text-sm text-destructive">{manualNotice}</p>
                  <Label htmlFor="credential-model-manual">모델 id (직접 입력)</Label>
                  <Input
                    id="credential-model-manual"
                    data-testid="credential-model-manual"
                    value={manualModel}
                    onChange={(e) => setManualModel(e.target.value)}
                    placeholder={`${presetKey}/model-id`}
                    autoComplete="off"
                    // Enter 로도 제출한다(WP-1622) — 한글 조합을 확정하는 Enter 는 제출로 이어지지 않게 공용 훅이 거른다.
                    onCompositionEnd={enterKey.onCompositionEnd}
                    onKeyDown={(e) => enterKey.handleEnter(e, submitOnEnter)}
                  />
                </div>
              ) : null}

              {/* 모델이 정해질 수 있는 상태(목록 노출 또는 프로브 실패·빈 목록 → 수동 입력)에서만 노출. */}
              {probe.models != null || probe.error ? (
                <VisionInputSelect
                  id="credential-vision"
                  testId="credential-vision"
                  value={vision}
                  onChange={setVision}
                />
              ) : null}
            </div>
          )}

        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => requestClose(false)}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={submitDisabled}>
            {mutation.isPending ? '저장 중…' : isReissue ? '변경' : '연결하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
