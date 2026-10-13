import { describe, expect, it } from 'vitest';

import type { ContentBlock } from '@/types/home';

import { pushMemoryBlock, pushTextBlock, pushToolsBlock, pushWidgetBlock, reconcileBlocks, sliceRange, splitBlocks } from './chatBlocks';

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

// WP-157: 도구 호출 그룹 블록 — 텍스트 사이에 끼어 다음 텍스트/도구가 새 풍선으로 분리되게 한다.
describe('pushToolsBlock', () => {
  it('직전 블록이 tools 가 아니면 새 tools 블록을 추가한다(stepStart=현재 steps 길이)', () => {
    const blocks: ContentBlock[] = [{ kind: 'text', textStart: 0 }];
    const result = pushToolsBlock(blocks, 2);
    expect(result).toEqual([
      { kind: 'text', textStart: 0 },
      { kind: 'tools', stepStart: 2 },
    ]);
  });

  it('직전 블록이 tools 면 같은 그룹으로 취급해 새 블록을 만들지 않는다', () => {
    const blocks: ContentBlock[] = [{ kind: 'tools', stepStart: 0 }];
    expect(pushToolsBlock(blocks, 1)).toBe(blocks);
  });
});

describe('sliceRange', () => {
  const blocks: ContentBlock[] = [
    { kind: 'tools', stepStart: 0 },
    { kind: 'text', textStart: 0 },
    { kind: 'tools', stepStart: 2 },
    { kind: 'text', textStart: 7 },
  ];

  it('같은 종류의 다음 블록 시작 오프셋까지를 범위로 돌려준다', () => {
    expect(sliceRange(blocks, 0)).toEqual([0, 2]);
    expect(sliceRange(blocks, 1)).toEqual([0, 7]);
  });

  it('같은 종류의 다음 블록이 없으면 끝(undefined)까지다', () => {
    expect(sliceRange(blocks, 2)).toEqual([2, undefined]);
    expect(sliceRange(blocks, 3)).toEqual([7, undefined]);
  });
});

describe('tool→delta→tool→delta 인터리브 시퀀스 (WP-157)', () => {
  it('[tools, text, tools, text] 순으로 분리 누적된다', () => {
    let blocks: ContentBlock[] = [];
    blocks = pushToolsBlock(blocks, 0); // 도구A start (steps 0개 상태)
    blocks = pushTextBlock(blocks, 0); // 텍스트1 첫 delta
    blocks = pushTextBlock(blocks, 4); // 텍스트1 연속 delta
    blocks = pushToolsBlock(blocks, 1); // 도구B start (steps 1개 상태)
    blocks = pushToolsBlock(blocks, 2); // 도구C 연속 — 같은 그룹
    blocks = pushTextBlock(blocks, 8); // 텍스트2 — 새 풍선

    expect(blocks).toEqual([
      { kind: 'tools', stepStart: 0 },
      { kind: 'text', textStart: 0 },
      { kind: 'tools', stepStart: 1 },
      { kind: 'text', textStart: 8 },
    ]);
  });
});

// WP-55: memory 블록은 항상 끝에 모인다(서버 ChatBlockRecorder 가 끝에 붙이는 순서와 같게) — 텍스트·도구·위젯은 그 앞에 쌓이고,
// memory 가 끼어도 텍스트 풍선이 끊기지 않는다.
describe('memory 블록 (WP-55)', () => {
  const saved = { action: 'saved' as const, memoryId: 12, kind: 'PREFERENCE' as const, content: '짧은 목록', source: 'AI' as const };

  it('pushMemoryBlock 은 끝에 붙이고 종류는 memoryKind, source 없으면 AI', () => {
    const b = pushMemoryBlock([{ kind: 'text', textStart: 0 }], { ...saved, source: undefined });
    expect(b).toEqual([
      { kind: 'text', textStart: 0 },
      { kind: 'memory', action: 'saved', memoryId: 12, memoryKind: 'PREFERENCE', content: '짧은 목록', source: 'AI', undone: false },
    ]);
  });

  it('memory 뒤에 온 텍스트는 직전 표시 블록이 text 면 새 블록을 만들지 않는다', () => {
    const b = pushMemoryBlock([{ kind: 'text', textStart: 0 }], saved);
    expect(pushTextBlock(b, 5)).toBe(b);
  });

  it('새 표시 블록은 memory 꼬리 앞에 들어간다', () => {
    let b = pushMemoryBlock([{ kind: 'text', textStart: 0 }], saved);
    b = pushToolsBlock(b, 0);
    b = pushTextBlock(b, 5);
    b = pushWidgetBlock(b, { type: 'issue_list', params: {} });
    expect(b.map((x) => x.kind)).toEqual(['text', 'tools', 'text', 'widget', 'memory']);
    expect(sliceRange(b, 0)).toEqual([0, 5]);
  });

  it('splitBlocks 는 한 번에 표시 블록과 memory 블록으로 나눈다(순서 유지, null·undefined 는 빈 배열)', () => {
    const b = pushMemoryBlock(pushMemoryBlock([{ kind: 'text', textStart: 0 }], saved), { ...saved, memoryId: 13 });
    const { display, memory } = splitBlocks([...b, { kind: 'widget', widget: { type: 'issue_list', params: {} } }]);
    expect(display.map((x) => x.kind)).toEqual(['text', 'widget']);
    expect(memory.map((m) => m.memoryId)).toEqual([12, 13]);
    expect(splitBlocks(undefined)).toEqual({ display: [], memory: [] });
    expect(splitBlocks(null)).toEqual({ display: [], memory: [] });
  });

  it('고침 결과의 previousKind 를 블록에 옮긴다(없으면 키 없음)', () => {
    const updated = { action: 'updated' as const, memoryId: 9, kind: 'CONTEXT' as const, content: '백엔드 팀', previousContent: '짧은 목록', previousKind: 'PREFERENCE' as const };
    expect(pushMemoryBlock([], updated)[0]).toMatchObject({ memoryKind: 'CONTEXT', previousContent: '짧은 목록', previousKind: 'PREFERENCE' });
    expect(pushMemoryBlock([], saved)[0]).not.toHaveProperty('previousKind');
  });

  it('reconcileBlocks 는 memory 블록을 지우지 않는다', () => {
    const b = pushMemoryBlock([{ kind: 'widget', widget: { type: 'issue_list', params: {} } }], saved);
    expect(reconcileBlocks(b, []).map((x) => x.kind)).toEqual(['memory']);
  });
});
