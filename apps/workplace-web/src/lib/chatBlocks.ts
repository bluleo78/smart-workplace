import type { ContentBlock, MemoryBlock, WidgetSpec } from '@/types/home';

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

/**
 * WP-581: 메모리 결과 줄 도착 — 직전 블록이 memories 가 아니면 새 memories 블록을 추가한다(연속 결과 줄은 한 묶음).
 * memoryStart 는 현재 memoryBlocks 누적 길이. 결과 줄이 흐름 안에 끼므로 뒤이은 도구·텍스트는 새 블록으로 시작해
 * 결과 줄 앞의 도구 그룹·말풍선에 이어 붙지 않는다. 앞에 블록이 없으면(답보다 먼저 기억) 끼우지 않는다 — 그 줄은 답 아래에 둔다.
 */
export function pushMemoriesBlock(blocks: ContentBlock[], memoriesLen: number): ContentBlock[] {
  if (blocks.length === 0 || blocks[blocks.length - 1].kind === 'memories') return blocks;
  return [...blocks, { kind: 'memories', memoryStart: memoriesLen }];
}

/**
 * WP-581: 이력 복원 — 메모리 블록의 at(앞에 오는 표시 블록 수) 자리에 memories 블록을 끼워 라이브와 같은 흐름을 만든다.
 * at 이 0 인 줄(답보다 먼저 기억)은 라이브처럼 끼우지 않는다. 줄 하나라도 at 이 없으면(구 블록·서버가 표시 블록을 버린 턴)
 * 아무것도 끼우지 않는다 — 결과 줄은 기존처럼 답 아래에 모인다.
 */
export function insertMemoryBlocks(blocks: ContentBlock[], memories: MemoryBlock[]): ContentBlock[] {
  if (!memories.length || memories.some((m) => typeof m.at !== 'number')) return blocks;
  const out: ContentBlock[] = [];
  let mi = 0;
  for (let i = 0; i < blocks.length; i++) {
    out.push(blocks[i]);
    // 이 블록 뒤(at = i + 1)에 온 결과 줄 묶음. at 은 도착순이라 줄지 않고, 끝을 넘는 at 은 마지막 블록 뒤로 모은다.
    let start = -1;
    while (mi < memories.length && (memories[mi].at! <= i + 1 || i === blocks.length - 1)) {
      if (memories[mi].at! > 0 && start < 0) start = mi;
      mi++;
    }
    if (start >= 0) out.push({ kind: 'memories', memoryStart: start });
  }
  return out;
}

/** 블록이 가리키는 원본(content/steps/memoryBlocks) 시작 오프셋 — widget 은 오프셋이 없다. */
function startOf(b: ContentBlock): number | undefined {
  switch (b.kind) {
    case 'text':
      return b.textStart;
    case 'tools':
      return b.stepStart;
    case 'memories':
      return b.memoryStart;
    case 'widget':
      return undefined;
  }
}

/**
 * WP-157: text/tools/memories 블록의 슬라이스 범위 [시작, 끝) — 끝은 같은 종류 다음 블록의 시작(없으면 undefined=끝까지).
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
