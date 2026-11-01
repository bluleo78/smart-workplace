import { describe, expect, it } from 'vitest';

import { buildViewerContext } from './viewer';

describe('buildViewerContext', () => {
  it('미리 보는 항목 → 파일 대상(식별자는 aiRefs 그대로, 크기·형식 facts)', () => {
    expect(
      buildViewerContext({ name: '견적서.pdf', mimeType: 'application/pdf', sizeBytes: 2_500_000, aiRefs: { source: 'mail', attachmentId: 5 } }),
    ).toEqual({
      view: '미리 보기',
      focus: {
        type: '파일',
        label: '견적서.pdf',
        refs: { source: 'mail', attachmentId: '5' },
        facts: [
          { label: '크기', value: '2.4 MB' },
          { label: '형식', value: 'application/pdf' },
        ],
      },
    });
  });

  it('읽을 식별자가 없는 항목은 refs 를 비우고(추측 id 미전송) 크기를 모르면 생략한다', () => {
    const ctx = buildViewerContext({ name: 'a.png', mimeType: 'image/png', sizeBytes: null });
    expect(ctx.focus!.refs).toEqual({});
    expect(ctx.focus!.facts).toEqual([{ label: '형식', value: 'image/png' }]);
  });
});
