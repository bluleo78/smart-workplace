// 빈 AI 대화 추천 질문의 순수 규칙(WP-139) — 즉시 보일 고정 문구(스펙 §4.4), 머리말, 저장 키, 교체 보류.
// AI 결과가 오기 전(또는 실패)에 보이는 문구라 모두 조회·정리 요청이다. 추천을 끈 사용자에게는 호출부(AIChatPanel)가 목록 자체를 그리지 않는다(스펙 §10.6). API AiSuggestionService.isTailored 와 같은 화면 맞춤 판정을 쓴다.
import { contextIdentity } from '@/lib/aiScreenContext/common';
import type { AiScreenContext } from '@/types/aiScreenContext';

/** 일반(화면 참고 없음·대상 없는 화면) 4개. */
export const GENERAL_STARTERS: readonly string[] = [
  '오늘 일정 요약해줘',
  '나를 멘션한 메시지 정리해줘',
  '내 작업 우선순위 정리해줘',
  '답장이 필요한 메일 알려줘',
];

/** 대상 종류(focus.type — builders 의 표시 이름)별 3개. */
const BY_FOCUS_TYPE: Record<string, readonly string[]> = {
  이슈: ['이 이슈 관련 작업 정리해줘', '비슷한 이슈 찾아줘', '이 이슈를 막고 있는 이슈 상태 알려줘'],
  '위키 페이지': ['이 노트에서 할 일 뽑아줘', '이 노트와 관련된 이슈 찾아줘', '이 노트를 링크한 문서 보여줘'],
  메일: ['이 메일에서 할 일 뽑아줘', '이 메일과 관련된 이슈 찾아줘', '보낸 사람과 최근 주고받은 메일 보여줘'],
  파일: ['이 파일 핵심 내용 정리해줘', '이 파일과 관련된 이슈 찾아줘', '이 파일에서 할 일 뽑아줘'],
  스레드: ['이 스레드 결론 정리해줘', '이 스레드에서 할 일 뽑아줘', '이 스레드와 관련된 이슈 찾아줘'],
  일정: ['이 회의 준비할 것 정리해줘', '참석자들과 관련된 진행 중 이슈 보여줘', '이 일정 앞뒤로 비는 시간 알려줘'],
};
/** 연락처는 구성원(refs.username)·외부(refs.externalId)가 다르다 — 외부 연락처는 담당 이슈가 없다. */
const CONTACT_MEMBER: readonly string[] = ['이 사람과 최근 주고받은 메일 보여줘', '이 사람이 담당한 진행 중 이슈 보여줘', '이 사람과 다음 회의 일정 알려줘'];
const CONTACT_EXTERNAL: readonly string[] = ['이 사람과 최근 주고받은 메일 보여줘', '이 사람과 다음 회의 일정 알려줘'];

/** 화면 맞춤인가 — 보고 있는 대상이 있고 식별자가 1개 이상(새 일정 작성 중처럼 refs 가 비면 일반). 참이면 focus 가 있다. */
export function isTailoredContext(
  ctx: AiScreenContext | null,
): ctx is AiScreenContext & { focus: NonNullable<AiScreenContext['focus']> } {
  return !!ctx?.focus && Object.keys(ctx.focus.refs ?? {}).length > 0;
}

/** 표에 있는 화면 맞춤 고정 문구 — 없으면 null(일반 문구를 쓴다). fixedStarters·starterHeading 이 같은 판정을 쓰게 한 곳에 둔다. */
function tailoredStarters(ctx: AiScreenContext | null): readonly string[] | null {
  if (!isTailoredContext(ctx)) return null;
  const { type, refs } = ctx.focus;
  if (type === '연락처') return refs.username ? CONTACT_MEMBER : refs.externalId ? CONTACT_EXTERNAL : null;
  return BY_FOCUS_TYPE[type] ?? null;
}

/** 즉시 보일 고정 문구. ctx 는 화면 참고 칩이 켜졌을 때만 넘긴다. */
export function fixedStarters(ctx: AiScreenContext | null): string[] {
  return [...(tailoredStarters(ctx) ?? GENERAL_STARTERS)];
}

/** 목록 머리말 — 맞춤 문구를 보일 때만 "이 {대상 종류}에 대해", 일반 문구면 '추천 질문'(문구와 머리말이 어긋나지 않게). */
export function starterHeading(ctx: AiScreenContext | null): string {
  return tailoredStarters(ctx) && ctx?.focus ? `이 ${ctx.focus.type}에 대해` : '추천 질문';
}

/** 저장·조회 키 — 화면 참고가 없으면 'general', 있으면 화면 정체성(건수·facts 같은 휘발 값 제외). */
export function starterContextKey(ctx: AiScreenContext | null): string {
  return contextIdentity(ctx) ?? 'general';
}

/** 화면에 보이는 추천 목록 상태 — key 는 지금 대상, incoming 은 도착했지만 아직 반영하지 않은 AI 결과. */
export interface StarterView {
  key: string;
  shown: string[];
  incoming: { key: string; items: string[] } | null;
}

/**
 * 교체 규칙(스펙 §2.1) — 포인터가 목록 위거나 포커스가 안에 있으면(held) 미룬다(누르려는 순간 문구가 바뀌지 않게).
 * 다른 대상의 늦은 결과는 버린다. 바뀔 게 없으면 같은 참조를 돌려준다(렌더 중 상태 조정이 수렴하게).
 */
export function settleStarterView(view: StarterView, held: boolean): StarterView {
  if (!view.incoming) return view;
  if (view.incoming.key !== view.key) return { ...view, incoming: null };
  if (held) return view;
  return { ...view, shown: view.incoming.items, incoming: null };
}
