// WP-414 설정 화면 컨텍스트 builder — view·도움말 요약·focus/facts 배치·한도.
import { describe, expect, it } from 'vitest';

import { chipLabel, LIMITS } from '../common';
import { buildSettingsScreenContext, helpSummaryPairs } from './settings';

describe('buildSettingsScreenContext', () => {
  /** 도움말 요약 쌍으로 만든 컨텍스트 — SettingsPage 가 help 로 만드는 것과 같다. */
  const build = (title: string, summary: Array<{ label: string; text: string }>, extra?: Parameters<typeof buildSettingsScreenContext>[2]) =>
    buildSettingsScreenContext(title, helpSummaryPairs(summary), extra)

  it('view 는 「설정 · 이름」이고 칩도 그 문구 한 번만 보이게 focus 는 없다', () => {
    const ctx = build('SSO', [{ label: '소개', text: 'A' }])
    expect(ctx.view).toBe('설정 · SSO')
    expect(ctx.focus).toBeUndefined()
    expect(chipLabel(ctx)).toBe('설정 · SSO')
  })

  it('긴 문구·많은 항목은 잘라서 한도를 지킨다', () => {
    const summary = [{ label: '소개', text: '나'.repeat(500) }, ...Array.from({ length: 20 }, (_, i) => ({ label: `팁 ${i}`, text: `팁 ${i}` }))]
    const ctx = build('가'.repeat(80), summary)
    expect(ctx.view.length).toBe(LIMITS.view)
    expect(ctx.scope!.facts!.length).toBe(LIMITS.facts)
    expect(ctx.scope!.facts![0].value.length).toBe(LIMITS.factValue)
    expect(ctx.scope!.facts!.at(-1)!.label).toBe('그 밖의 안내')
  })

  it('상태 값(facts)은 도움말 요약보다 앞에 둔다', () => {
    const ctx = build('SSO', [{ label: '소개', text: 'A' }], { facts: [['SSO 로그인', '켜짐']] })
    expect(ctx.scope!.facts![0]).toEqual({ label: 'SSO 로그인', value: '켜짐' })
  })

  it('대상이 있으면 focus(type·label·refs·facts)를 싣는다', () => {
    const ctx = build('사용자 상세', [{ label: '소개', text: 'A' }], {
      focus: { type: '사용자', label: '홍길동', refs: { username: 'hong' }, facts: [['역할', 'ADMIN, MEMBER'], ['활성', '활성']] },
    })
    expect(ctx.focus).toEqual({
      type: '사용자',
      label: '홍길동',
      refs: { username: 'hong' },
      facts: [{ label: '역할', value: 'ADMIN, MEMBER' }, { label: '활성', value: '활성' }],
    })
  })

  it('대상 이름이 비면(미로드) focus 를 싣지 않는다', () => {
    const ctx = build('사용자 상세', [{ label: '소개', text: 'A' }], { focus: { type: '사용자', label: '  ' } })
    expect(ctx.focus).toBeUndefined()
  })
})

// WP-1507: 가이드 글이 매뉴얼로 옮겨 간 화면 — 매뉴얼 대표 절 요약(useManualSummary)으로 같은 꼴의 화면 참고를 만든다.
describe('도움말 요약 경로(helpSummaryPairs)', () => {
  it('help 경로 — 요약이 있으면 view·scope 라벨은 「설정 · 이름」, facts 는 페이지 값 → 요약 순', () => {
    const ctx = buildSettingsScreenContext('에이전트', helpSummaryPairs([{ label: '소개', text: 'A' }]), { facts: [['상태', '켜짐']] });
    expect(ctx.view).toBe('설정 · 에이전트');
    expect(chipLabel(ctx)).toBe('설정 · 에이전트');
    expect(ctx.scope!.label).toBe('설정 · 에이전트');
    expect(ctx.scope!.facts![0]).toEqual({ label: '상태', value: '켜짐' });
    expect(ctx.scope!.facts![1]).toEqual({ label: '소개', value: 'A' });
  });

  it('요약이 아직 없으면(null) 화면 이름과 페이지 값만 — focus 는 그대로', () => {
    const bare = buildSettingsScreenContext('에이전트 상세', helpSummaryPairs(null));
    expect(bare.view).toBe('설정 · 에이전트 상세');
    expect(bare.scope!.facts).toBeUndefined();
    expect(bare.focus).toBeUndefined();
    const withFocus = buildSettingsScreenContext('에이전트 상세', helpSummaryPairs(null), {
      focus: { type: '에이전트', label: '지니', refs: { username: 'genie' } },
    });
    expect(withFocus.scope!.facts).toBeUndefined();
    expect(withFocus.focus).toEqual({ type: '에이전트', label: '지니', refs: { username: 'genie' } });
  });

  it('요약이 상한을 넘으면 「그 밖의 안내」로 줄인다', () => {
    const summary = Array.from({ length: 20 }, (_, i) => ({ label: `절 ${i}`, text: `첫 문단 ${i}` }));
    const facts = buildSettingsScreenContext('에이전트', helpSummaryPairs(summary), { facts: [['상태', '켜짐']] }).scope!.facts!;
    expect(facts.length).toBe(LIMITS.facts);
    expect(facts[0]).toEqual({ label: '상태', value: '켜짐' });
    expect(facts.at(-1)!.label).toBe('그 밖의 안내');
  });

  it('표 항목은 행을 「; 」 로 이어 한 칸(200자) 안에 묶고, 넘치면 「머리 2」 로 나눈다', () => {
    const rows = ['확인 필요 — 아직 확인하지 않았습니다', '종료됨', ...Array.from({ length: 6 }, (_, i) => `긴 상태 ${i + 1} — ${'가'.repeat(30)}`)];
    const pairs = helpSummaryPairs([{ label: '소개', text: '계정 본문.' }, { label: '상태', rows }]);
    expect(pairs[0]).toEqual(['소개', '계정 본문.']);
    expect(pairs.slice(1).map(([l]) => l)).toEqual(['상태', '상태 2']);
    expect(String(pairs[1][1])).toMatch(/^확인 필요 — 아직 확인하지 않았습니다; 종료됨; 긴 상태 1 — /);
    for (const [, v] of pairs) expect(String(v).length).toBeLessThanOrEqual(LIMITS.factValue);
    expect(String(pairs[2][1])).toContain('긴 상태 6');
  });
});
