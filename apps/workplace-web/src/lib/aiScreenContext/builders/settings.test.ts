// WP-414 설정 화면 컨텍스트 builder — view·가이드 요약·focus/facts 배치·한도.
import { describe, expect, it } from 'vitest';

import { settingsGuides } from '@/components/settings-guide/settingsGuides';
import type { SettingsGuide } from '@/components/settings-guide/types';

import { chipLabel, LIMITS } from '../common';
import { buildSettingsScreenContext } from './settings';

describe('buildSettingsScreenContext', () => {
  it('view 는 「설정 · 제목」이고 칩도 그 문구 한 번만 보인다', () => {
    const ctx = buildSettingsScreenContext(settingsGuides.sso);
    expect(ctx.view).toBe('설정 · SSO');
    expect(ctx.focus).toBeUndefined();
    expect(chipLabel(ctx)).toBe('설정 · SSO');
  });

  it('가이드 요약을 소개 → 주의 → 알아두기 순으로 scope.facts 에 싣는다', () => {
    const g = settingsGuides.userDetail;
    const facts = buildSettingsScreenContext(g).scope!.facts!;
    expect(facts[0]).toEqual({ label: '소개', value: g.lead });
    expect(facts.map((f) => f.label)).toEqual(['소개', ...g.tips.map((_, i) => `알아두기 ${i + 1}`)]);
    const withCaution = buildSettingsScreenContext(settingsGuides.assistant).scope!.facts!;
    expect(withCaution[1]).toEqual({ label: '주의', value: settingsGuides.assistant.caution });
  });

  it('8개 가이드 모두 서버 한도 안에 든다', () => {
    for (const g of Object.values(settingsGuides) as SettingsGuide[]) {
      const ctx = buildSettingsScreenContext(g, { facts: [['SSO 로그인', '켜짐']] });
      expect(ctx.view.length).toBeLessThanOrEqual(LIMITS.view);
      expect(ctx.scope!.label.length).toBeLessThanOrEqual(LIMITS.label);
      const facts = ctx.scope!.facts!;
      expect(facts.length).toBeLessThanOrEqual(LIMITS.facts);
      for (const f of facts) {
        expect(f.label.length).toBeLessThanOrEqual(LIMITS.factLabel);
        expect(f.value.length).toBeLessThanOrEqual(LIMITS.factValue);
      }
    }
  });

  it('긴 문구·많은 항목은 잘라서 한도를 지킨다', () => {
    const g: SettingsGuide = { title: '가'.repeat(80), lead: '나'.repeat(500), tips: Array.from({ length: 20 }, (_, i) => `팁 ${i}`) };
    const ctx = buildSettingsScreenContext(g);
    expect(ctx.view.length).toBe(LIMITS.view);
    expect(ctx.scope!.facts!.length).toBe(LIMITS.facts);
    expect(ctx.scope!.facts![0].value.length).toBe(LIMITS.factValue);
    expect(ctx.scope!.facts!.at(-1)!.label).toBe('그 밖의 안내');
  });

  it('상태 값(facts)은 가이드 요약보다 앞에 둔다', () => {
    const ctx = buildSettingsScreenContext(settingsGuides.sso, { facts: [['SSO 로그인', '켜짐']] });
    expect(ctx.scope!.facts![0]).toEqual({ label: 'SSO 로그인', value: '켜짐' });
  });

  it('대상이 있으면 focus(type·label·refs·facts)를 싣는다', () => {
    const ctx = buildSettingsScreenContext(settingsGuides.userDetail, {
      focus: { type: '사용자', label: '홍길동', refs: { username: 'hong' }, facts: [['역할', 'ADMIN, MEMBER'], ['활성', '활성']] },
    });
    expect(ctx.focus).toEqual({
      type: '사용자',
      label: '홍길동',
      refs: { username: 'hong' },
      facts: [{ label: '역할', value: 'ADMIN, MEMBER' }, { label: '활성', value: '활성' }],
    });
  });

  it('대상 이름이 비면(미로드) focus 를 싣지 않는다', () => {
    const ctx = buildSettingsScreenContext(settingsGuides.userDetail, { focus: { type: '사용자', label: '  ' } });
    expect(ctx.focus).toBeUndefined();
  });
});
