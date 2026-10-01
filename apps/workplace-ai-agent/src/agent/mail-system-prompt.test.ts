// WP-149: 원본/개인 분석 프롬프트 스냅샷 — 요청 플래그 조합별로 지시·출력 필드가 정확히 들어가고 빠지는지 고정한다.
import { describe, expect, it } from 'vitest';

import { buildContentAnalysisPrompt, buildPersonalAnalysisPrompt } from './mail-system-prompt.js';

describe('buildContentAnalysisPrompt', () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
  ])('includeCategory=%s includeSummary=%s', (includeCategory, includeSummary) => {
    expect(buildContentAnalysisPrompt({ includeCategory, includeSummary })).toMatchSnapshot();
  });

  it('요약을 빼면 summary 지시·필드가 모두 없다', () => {
    const p = buildContentAnalysisPrompt({ includeCategory: true, includeSummary: false });
    expect(p).not.toContain('summary');
    expect(p).toContain('"category"');
  });
});

describe('buildPersonalAnalysisPrompt', () => {
  it.each([
    [true, true, true],
    [true, true, false],
    [true, false, true],
    [true, false, false],
    [false, true, false],
  ])('needsReply=%s personalSummary=%s category=%s', (includeNeedsReply, includePersonalSummary, includeCategory) => {
    expect(buildPersonalAnalysisPrompt({ includeNeedsReply, includePersonalSummary, includeCategory })).toMatchSnapshot();
  });

  it('회신필요 기준 — [나] 직접 요청만 true, CC 는 직접 지칭 시만, 애매하면 false', () => {
    const p = buildPersonalAnalysisPrompt({ includeNeedsReply: true, includePersonalSummary: false, includeCategory: false });
    expect(p).toContain('[나]에게 직접');
    expect(p).toContain('CC');
    expect(p).toContain('애매하면 false');
    expect(p).not.toContain('personalSummary');
    expect(p).not.toContain('"category"');
  });
  it('WP-150 보강 블록 안내와 관계·이전 메일 규칙', () => {
    const p = buildPersonalAnalysisPrompt({ includeNeedsReply: true, includePersonalSummary: true, includeCategory: false });
    expect(p).toContain('[이전 메일]=같은 스레드의 직전 메일');
    expect(p).toContain('관계만으로 true 로 판단하지 마세요');
    expect(p).toContain('[나]가 이미 답했고');
    expect(p).toContain('이름·다른 이름·직함·주소로 직접 지칭');
    expect(p).toContain('연결 이슈 키');
  });

  it('원본 분석 프롬프트에는 개인 블록 안내가 없다', () => {
    expect(buildContentAnalysisPrompt({ includeCategory: true, includeSummary: true })).not.toContain('[이전 메일]=');
  });
});
