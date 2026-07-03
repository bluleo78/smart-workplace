// opencode 외부 프로바이더 프리셋 — ProviderCredentialDialog + AgentManagementPage(뱃지 표시)가 공유.
// baseURL 템플릿 자동 채움용. 프리셋은 UX 편의이며 providerId 는 opencode 설정에서
// 프로바이더 블록을 구분하는 키로만 쓰인다(백엔드는 값 자체를 검증하지 않음).

export const OPENCODE_PRESETS = [
  {
    key: 'amazon-bedrock-openai',
    label: 'AWS Bedrock',
    baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    key: 'google',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    key: 'custom',
    label: '직접 입력',
    baseUrl: '',
  },
] as const;

export type OpencodePresetKey = (typeof OPENCODE_PRESETS)[number]['key'];

// baseUrl → 프리셋 표시 라벨 역매핑. meta 응답에는 providerId 가 없고 baseUrl 만 있으므로
// host 기준으로 매칭한다(리전 등 host 이외 경로 차이는 무시 — 예: bedrock-mantle.*.api.aws
// 는 리전에 따라 host 자체가 달라지므로, 프리셋 host 의 리전 세그먼트를 와일드카드로 취급).
// 등록 후 상태 표시(뱃지)에서 재사용 — 미매칭 시 null(호출측이 "OpenAI 호환"으로 폴백).
export function presetLabelFor(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return null;
  }
  const preset = OPENCODE_PRESETS.find((p) => {
    if (!p.baseUrl) return false;
    let presetHost: string;
    try {
      presetHost = new URL(p.baseUrl).host;
    } catch {
      return false;
    }
    // 프리셋 host 의 리전 세그먼트(예: us-east-1)를 와일드카드로 치환해 비교.
    const pattern = presetHost.replace(/[a-z]{2}-[a-z]+-\d/, '[^.]+');
    return new RegExp(`^${pattern}$`).test(host);
  });
  return preset?.label ?? null;
}
