// 「생각의 깊이」 선택지와 보정(WP-1322) — 개인 비서·공통 비서 화면이 같이 쓴다.
// 선택지는 「설정 안 함」(DEFAULT, 모델 기본값) + 고른 모델이 받는 단계(낮은 순). 모델마다 받는 단계가 달라서, 저장된 단계를 그 모델이 받지 않으면
// 받는 단계 중 바로 아래(없으면 설정 안 함)로 보이고, 모델을 바꿀 때는 그 값으로 저장한다.
import type { ThinkingDepth, ThinkingLevel } from '@/types/assistant';
import type { CredentialProvider, ModelOption } from '@/types/providerCredential';

/** 낮은 순 전체 단계. */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'];

/** 화면 문구. */
export const THINKING_DEPTH_LABELS: Record<ThinkingDepth, string> = {
  DEFAULT: '설정 안 함',
  LOW: '낮게',
  MEDIUM: '보통',
  HIGH: '높게',
  XHIGH: '매우 높게',
  MAX: '최대',
};

/** Claude 모델의 지원 단계를 모를 때(Models API 가 알려 주지 않음·정적 폴백 목록) — 대부분의 Claude 모델이 받는 세 단계. */
const CLAUDE_FALLBACK: readonly ThinkingLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

/**
 * 고른 모델이 받는 단계(낮은 순). 모델 목록의 efforts 가 있으면 그것(모르는 값은 버림), 없으면 provider 기본 —
 * Claude 는 LOW·MEDIUM·HIGH, OpenAI 호환(opencode)·연결 없음은 빈 목록(「설정 안 함」만).
 */
export function supportedLevels(
  provider: CredentialProvider | string | null | undefined,
  model: ModelOption | undefined,
): ThinkingLevel[] {
  const efforts = model?.efforts;
  if (efforts != null) return THINKING_LEVELS.filter((l) => efforts.includes(l));
  return provider === 'anthropic' ? [...CLAUDE_FALLBACK] : [];
}

/** 모델 목록에서 그 모델을 찾아 받는 단계(supportedLevels). */
function levelsFor(
  provider: CredentialProvider | string | null | undefined,
  models: ModelOption[],
  modelId: string | null | undefined,
): ThinkingLevel[] {
  return supportedLevels(provider, models.find((m) => m.id === modelId));
}

/** 선택지 — 「설정 안 함」 다음 지원 단계(levels 는 이미 낮은 순). */
export function thinkingDepthOptions(levels: readonly ThinkingLevel[]): { value: ThinkingDepth; label: string }[] {
  return (['DEFAULT', ...levels] as ThinkingDepth[]).map((value) => ({ value, label: THINKING_DEPTH_LABELS[value] }));
}

/**
 * 저장값을 지원 단계에 맞춘다 — 받는 단계면 그대로, 아니면 받는 단계 중 바로 아래, 그것도 없으면 DEFAULT.
 * 미설정(null)·모르는 값(옛 NONE/NORMAL/DEEP 등)은 DEFAULT.
 */
export function clampThinkingDepth(saved: string | null | undefined, levels: readonly ThinkingLevel[]): ThinkingDepth {
  const idx = THINKING_LEVELS.indexOf(saved as ThinkingLevel);
  if (idx < 0) return 'DEFAULT';
  for (let i = idx; i >= 0; i -= 1) {
    if (levels.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  return 'DEFAULT';
}

/**
 * 화면 한 번에 필요한 값 — 선택지와 보정된 표시값. loading(모델 목록을 아직 모름)이면 보정하지 않고 저장값을 그대로 보인다
 * (목록이 오기 전에 잠깐 「설정 안 함」으로 보였다 바뀌지 않게).
 */
export function thinkingDepthView(p: {
  provider: CredentialProvider | string | null | undefined;
  models: ModelOption[];
  modelId: string | null | undefined;
  saved: string | null | undefined;
  loading?: boolean;
}): { options: { value: ThinkingDepth; label: string }[]; value: ThinkingDepth } {
  const levels = p.loading ? THINKING_LEVELS.filter((l) => l === p.saved) : levelsFor(p.provider, p.models, p.modelId);
  return { options: thinkingDepthOptions(levels), value: clampThinkingDepth(p.saved, levels) };
}

/**
 * 모델을 바꿀 때 같은 요청에 실을 생각의 깊이 — 새 모델이 저장값을 받지 않아 보정값이 달라지면 { thinkingDepth }, 같으면 빈 객체(보낸 필드만
 * 바꾸는 API 라 키를 빼면 그대로 둔다). 미설정(null)은 보정해도 DEFAULT 와 뜻이 같아 보내지 않는다.
 */
export function thinkingDepthPatchForModel(p: {
  provider: CredentialProvider | string | null | undefined;
  models: ModelOption[];
  nextModelId: string;
  saved: string | null | undefined;
}): { thinkingDepth?: ThinkingDepth } {
  if (p.saved == null) return {};
  const next = clampThinkingDepth(p.saved, levelsFor(p.provider, p.models, p.nextModelId));
  return next === p.saved ? {} : { thinkingDepth: next };
}
