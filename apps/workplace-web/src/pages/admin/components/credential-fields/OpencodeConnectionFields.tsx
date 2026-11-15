// OpenAI 호환 연결 칸(WP-1451) — 프리셋 · Base URL · API Key. 프리셋을 고르면 그 Base URL 을 채운다.
// AI 별 연결 창(ProviderCredentialDialog — 이어서 모델을 불러와 고른다)과 계정 목록의 계정 창(AgentAccountDialog — 모델은 AI 마다 고르므로 받지 않는다)이 같이 쓴다.
// 상태는 부르는 쪽이 갖는다 — 프리셋을 바꿀 때 지울 값(모델 목록 등)이 창마다 다르기 때문.
import type { KeyboardEvent } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';
import { OPENCODE_PRESETS, type OpencodePresetKey } from '@/lib/opencode-presets';

interface Props {
  /** 고른 프리셋 — null 이면 아직 안 고름(계정 수정의 키 교체는 주소를 다시 받으려 빈 채로 시작한다). 칸에 「프리셋을 고르세요」가 보인다. */
  presetKey: OpencodePresetKey | null;
  /** 프리셋을 바꿨다 — Base URL 은 이 칸이 프리셋 값으로 다시 채운다(onBaseUrlChange 로). */
  onPresetChange: (key: OpencodePresetKey) => void;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  /**
   * Base URL·API Key 한 줄 칸 Enter 로 부를 동작(WP-1622) — 부르는 창이 제출을 넘긴다(넘기지 않으면 Enter 를 다루지 않는다).
   * 「연결 확인」·「모델 불러오기」 같은 보조 동작은 Enter 로 부르지 않는다 — 제출 조건은 부르는 쪽 submit 이 지킨다.
   */
  onEnter?: () => void;
}

/** OpenAI 호환 엔드포인트의 프리셋·주소·키 칸. API Key 는 가려서 보인다. */
export function OpencodeConnectionFields({
  presetKey,
  onPresetChange,
  baseUrl,
  onBaseUrlChange,
  apiKey,
  onApiKeyChange,
  onEnter,
}: Props) {
  // 한 줄 칸 Enter 공용 처리(WP-331) — 두 칸이 하나를 같이 쓴다(초점은 한 번에 한 칸). onEnter 가 있을 때만 건다.
  const enterKey = useSingleLineEnter();
  const enterProps = onEnter
    ? {
        onCompositionEnd: enterKey.onCompositionEnd,
        onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => enterKey.handleEnter(e, onEnter),
      }
    : {};

  // 프리셋 변경 → 그 프리셋의 Base URL 템플릿으로 채운다(직접 입력 프리셋은 빈 값).
  const changePreset = (key: OpencodePresetKey) => {
    onPresetChange(key);
    onBaseUrlChange(OPENCODE_PRESETS.find((p) => p.key === key)?.baseUrl ?? '');
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="credential-preset">프리셋</Label>
        <Select value={presetKey ?? ''} onValueChange={(v) => changePreset(v as OpencodePresetKey)}>
          <SelectTrigger id="credential-preset" data-testid="credential-preset">
            <SelectValue placeholder="프리셋을 고르세요" />
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
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder="https://api.example.com/v1"
          autoComplete="off"
          {...enterProps}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="credential-api-key">API Key</Label>
        <PasswordInput
          id="credential-api-key"
          fieldLabel="API Key"
          data-testid="credential-api-key"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          autoComplete="off"
          {...enterProps}
        />
      </div>
    </>
  );
}

/** 프리셋 기본값 — 첫 프리셋(AWS Bedrock)과 그 Base URL. 두 창이 처음·초기화 때 같은 값으로 시작한다. */
export const DEFAULT_OPENCODE_PRESET: OpencodePresetKey = OPENCODE_PRESETS[0].key;
export const DEFAULT_OPENCODE_BASE_URL: string = OPENCODE_PRESETS[0].baseUrl;
