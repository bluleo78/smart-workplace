// 추천 질문 모델 선택지(WP-139) — 비서 모델 드롭다운과 같은 목록 + 맨 앞 "자동 (실제로 쓸 모델)". 개인·관리자 화면이 같이 쓴다.
// 자동 모델은 API 가 정해 상태 응답 suggestionModelAuto 로 준다(스펙 §10.3) — 웹에는 모델 id 상수를 두지 않는다(설정과 어긋나지 않게).
import type { ModelOption } from '@/types/providerCredential';

/** Radix Select 는 빈 문자열 값을 받지 않아 "자동"을 이 값으로 표시한다(저장 시 null). */
export const AUTO_SELECT_VALUE = '__auto__';

/**
 * 선택지 — [자동 (…), (목록에 없는 저장값), ...목록].
 *
 * @param autoModel 상태 응답의 suggestionModelAuto — 목록에 있으면 그 라벨, 없으면 id 를 괄호에. 모르면(연결 없음·구 API) "자동"
 */
export function suggestionModelChoices(p: {
  autoModel: string | null | undefined;
  value: string | null | undefined;
  options: ModelOption[];
}): ModelOption[] {
  const autoId = p.autoModel;
  const autoLabel = autoId ? `자동 (${p.options.find((o) => o.id === autoId)?.label ?? autoId})` : '자동';
  const saved = p.value && !p.options.some((o) => o.id === p.value) ? [{ id: p.value, label: p.value }] : [];
  return [{ id: AUTO_SELECT_VALUE, label: autoLabel }, ...saved, ...p.options];
}

/** `providerId/model` 형태의 모델 id 에서 providerId 를 뽑는다(opencode). 접두가 없으면(anthropic 등) undefined. */
export function providerIdOf(model: string | null | undefined): string | undefined {
  return model?.includes('/') ? model.split('/')[0] : undefined;
}

/**
 * 직접 입력한 모델 id 에 `providerId/` 접두가 없으면 붙인다 — 접두 없이 저장하면 opencode 실행 시점에 조용히 실패하는
 * 함정을 막는다. 추천 모델·비서 모델 직접 입력·opencode 자격증명 등록 폼(개인·관리자)이 같이 쓴다. providerId 를 모르면 입력 그대로.
 */
export function withProviderPrefix(raw: string, providerId: string | undefined): string {
  const t = raw.trim();
  return t && !t.includes('/') && providerId ? `${providerId}/${t}` : t;
}
