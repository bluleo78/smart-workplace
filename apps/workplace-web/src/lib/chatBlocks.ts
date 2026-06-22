import type { ContentBlock, WidgetSpec } from '@/types/home';

/**
 * #463: 텍스트 델타 도착 — 직전 블록이 text 가 아니면 새 text 블록을 추가한다.
 * textStart 는 현재 content 누적 길이(슬라이스 오프셋)이므로 불변 문자열 복사 없이
 * ChatTurn.content 를 공유한다.
 * text 가 연속이면 새 블록을 만들지 않는다(하나로 합쳐진 것으로 취급).
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
