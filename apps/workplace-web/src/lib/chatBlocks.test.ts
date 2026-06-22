import { describe, expect, it } from 'vitest';

import type { ContentBlock } from '@/types/home';

import { pushTextBlock, pushWidgetBlock, reconcileBlocks } from './chatBlocks';

// #463: ContentBlock 인터리브 누적 로직 — delta·tool 이벤트 시퀀스 검증.
describe('pushTextBlock', () => {
  it('빈 배열에 첫 텍스트 블록을 추가한다', () => {
    const result = pushTextBlock([], 0);
    expect(result).toEqual([{ kind: 'text', textStart: 0 }]);
  });

  it('직전 블록이 text 면 새 블록을 만들지 않는다(연속 delta)', () => {
    const blocks: ContentBlock[] = [{ kind: 'text', textStart: 0 }];
    const result = pushTextBlock(blocks, 10);
    expect(result).toBe(blocks); // 같은 배열 참조 반환 — 새 블록 없음
  });

  it('직전 블록이 widget 이면 새 text 블록을 추가한다', () => {
    const blocks: ContentBlock[] = [
      { kind: 'text', textStart: 0 },
      { kind: 'widget', widget: { type: 'issue_list' } },
    ];
    const result = pushTextBlock(blocks, 15);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ kind: 'text', textStart: 15 });
  });
});

describe('pushWidgetBlock', () => {
  it('빈 배열에 위젯 블록을 추가한다', () => {
    const result = pushWidgetBlock([], { type: 'my_tasks' });
    expect(result).toEqual([{ kind: 'widget', widget: { type: 'my_tasks' } }]);
  });

  it('위젯이 연속으로 와도 각각 별도 블록으로 추가한다', () => {
    const blocks: ContentBlock[] = [{ kind: 'widget', widget: { type: 'calendar' } }];
    const result = pushWidgetBlock(blocks, { type: 'mail_list' });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ kind: 'widget', widget: { type: 'mail_list' } });
  });
});

describe('reconcileBlocks', () => {
  it('widgets=[] 이면 모든 widget 블록을 제거하고 text 블록만 남긴다', () => {
    const blocks: ContentBlock[] = [
      { kind: 'text', textStart: 0 },
      { kind: 'widget', widget: { type: 'issue_detail', params: { issueId: 999 } } },
      { kind: 'text', textStart: 10 },
    ];
    const result = reconcileBlocks(blocks, []);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: 'text', textStart: 0 });
    expect(result[1]).toEqual({ kind: 'text', textStart: 10 });
  });

  it('widgets 에 해당 위젯이 있으면 widget 블록을 유지한다', () => {
    const widget = { type: 'my_tasks' as const, params: {} };
    const blocks: ContentBlock[] = [
      { kind: 'text', textStart: 0 },
      { kind: 'widget', widget },
    ];
    const result = reconcileBlocks(blocks, [widget]);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ kind: 'widget', widget });
  });

  it('widgets 에 없는 위젯만 제거한다(다른 위젯은 유지)', () => {
    const good = { type: 'my_tasks' as const, params: {} };
    const bad = { type: 'issue_detail' as const, params: { issueId: 999 } };
    const blocks: ContentBlock[] = [
      { kind: 'widget', widget: bad },
      { kind: 'widget', widget: good },
    ];
    const result = reconcileBlocks(blocks, [good]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'widget', widget: good });
  });
});

describe('delta→tool→delta 인터리브 시퀀스', () => {
  it('[text, widget, text] 순으로 누적된다', () => {
    // 1단계: 첫 텍스트 델타 (content 길이 0에서 시작)
    let blocks: ContentBlock[] = [];
    blocks = pushTextBlock(blocks, 0);
    // 2단계: 추가 delta — text 연속이므로 새 블록 없음 (content 5자 누적됨)
    blocks = pushTextBlock(blocks, 5);
    // 3단계: show_* 위젯 도착
    blocks = pushWidgetBlock(blocks, { type: 'issue_list', params: { projectId: 1 } });
    // 4단계: 위젯 후 텍스트 delta — 새 text 블록(textStart=5, 첫 텍스트 구간 종료)
    const contentLenAfterFirstText = 5;
    blocks = pushTextBlock(blocks, contentLenAfterFirstText);
    // 5단계: 추가 delta — 연속이므로 새 블록 없음
    blocks = pushTextBlock(blocks, 10);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: 'text', textStart: 0 });
    expect(blocks[1]).toEqual({ kind: 'widget', widget: { type: 'issue_list', params: { projectId: 1 } } });
    expect(blocks[2]).toEqual({ kind: 'text', textStart: 5 });
  });
});
