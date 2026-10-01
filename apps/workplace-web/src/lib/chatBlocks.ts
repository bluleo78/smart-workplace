import type { ContentBlock, WidgetSpec } from '@/types/home';

/**
 * #463: 텍스트 델타 도착 — 직전 블록이 text 가 아니면 새 text 블록을 추가한다.
 * textStart 는 현재 content 누적 길이(슬라이스 오프셋)이므로 불변 문자열 복사 없이
 * ChatTurn.content 를 공유한다.
 * text 가 연속이면 새 블록을 만들지 않는다(하나로 합쳐진 것으로 취급).
 * 주의: text 연속 시 contentLen 은 무시하고 기존 블록을 그대로 반환한다.
 */
export function pushTextBlock(blocks: ContentBlock[], contentLen: number): ContentBlock[] {
  if (blocks.length > 0 && blocks[blocks.length - 1].kind === 'text') return blocks;
  return [...blocks, { kind: 'text', textStart: contentLen }];
}

/**
 * #463: 위젯(show_*) 도착 — widget 블록을 도착순으로 추가한다.
 * 같은 위젯이 연속으로 와도 각각 별도 블록으로 추가한다(다른 타입의 위젯일 수 있음).
 */
export function pushWidgetBlock(blocks: ContentBlock[], widget: WidgetSpec): ContentBlock[] {
  return [...blocks, { kind: 'widget', widget }];
}

/**
 * WP-157: 도구 호출/위임 단계 도착 — 직전 블록이 tools 가 아니면 새 tools 블록을 추가한다.
 * stepStart 는 현재 steps 누적 길이(슬라이스 오프셋). 블록이 텍스트 사이에 끼므로 이후 delta 는
 * pushTextBlock 이 새 text 블록을 만들어, 도구 다음 텍스트가 이전 텍스트 풍선에 이어 붙지 않는다.
 * 연속 도구는 같은 그룹(한 풍선)으로 합친다.
 */
export function pushToolsBlock(blocks: ContentBlock[], stepsLen: number): ContentBlock[] {
  if (blocks.length > 0 && blocks[blocks.length - 1].kind === 'tools') return blocks;
  return [...blocks, { kind: 'tools', stepStart: stepsLen }];
}

/** 블록이 가리키는 원본(content/steps) 시작 오프셋 — widget 은 오프셋이 없다. */
const startOf = (b: ContentBlock): number | undefined =>
  b.kind === 'text' ? b.textStart : b.kind === 'tools' ? b.stepStart : undefined;

/**
 * WP-157: text/tools 블록의 슬라이스 범위 [시작, 끝) — 끝은 같은 종류 다음 블록의 시작(없으면 undefined=끝까지).
 * 다른 종류 블록은 오프셋 공간이 달라(content 문자 vs steps 인덱스) 범위 계산에서 건너뛴다.
 */
export function sliceRange(blocks: ContentBlock[], index: number): [number, number | undefined] {
  const b = blocks[index];
  const next = blocks.slice(index + 1).find((x) => x.kind === b.kind);
  return [startOf(b) ?? 0, next ? startOf(next) : undefined];
}

/**
 * #463 I1: done 시 authoritative widgets(서버 #404 필터 후)로 contentBlocks 의 widget 블록을 정리한다.
 * text·tools 블록은 보존, widget 블록은 authoritative 목록에 (type+params 동일) 있을 때만 유지한다.
 * r.widgets 가 비어도(undefined/[]) 재조정해야 하므로 — 전부 필터된 경우 widget 블록 전부 제거.
 */
export function reconcileBlocks(blocks: ContentBlock[], widgets: WidgetSpec[]): ContentBlock[] {
  const key = (w: WidgetSpec) => `${w.type}:${JSON.stringify(w.params ?? {})}`;
  const allowed = new Set(widgets.map(key));
  return blocks.filter((b) => b.kind !== 'widget' || allowed.has(key(b.widget)));
}
