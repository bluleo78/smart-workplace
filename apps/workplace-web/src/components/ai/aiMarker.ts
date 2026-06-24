// AI 시각 마커 — 역할별 클래스 빌더(단일 소스).
// 색은 ai-accent 시맨틱 토큰만 사용(디자인 시스템 SSoT, hex/하드코딩색 금지).
// 컴포넌트(AiContent/AiSignalBadge/AiLabel)가 이 값을 소비하고, 순수 함수라 vitest(node)로 검증한다.

// ③ 판단신호 배지 종류: action=사용자 행동 필요(회신필요 등), info=정보성 분류.
export type AiSignalVariant = 'action' | 'info'

// 스크린리더용 라벨(✨ 단독 인지 불가 보완).
export const AI_MARKER_ARIA = 'AI 생성 콘텐츠'

// ② 생성물 아우라 컨테이너 — 좌측 보더 + 연한 틴트.
export const AI_CONTENT_CONTAINER_CLASS =
  'border-l-[3px] border-ai-accent bg-ai-accent-subtle rounded-r-md px-3 py-2'

// ✨ + 텍스트 인라인 라벨(AiLabel 및 AiContent 헤더 공용).
export const AI_LABEL_CLASS =
  'inline-flex items-center gap-1 text-xs font-semibold text-ai-accent'

// ③ 배지 컨테이너 클래스 — variant별 채움/연함.
export function aiSignalBadgeClass(variant: AiSignalVariant): string {
  const base =
    'inline-flex flex-none items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold'
  const tone =
    variant === 'action'
      ? 'bg-ai-accent text-ai-accent-foreground'
      : 'bg-ai-accent-subtle text-ai-accent'
  return `${base} ${tone}`
}
