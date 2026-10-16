// 설정 화면 컨텍스트 builder(WP-414) — 설정 가이드가 있는 화면에서 AI 가 「이 설정」 이 무엇인지 알게 한다.
// - view 「설정 · <가이드 제목>」, scope.facts 에 가이드 요약(소개·주의·알아두기)을 실어 AI 가 화면 규칙을 같은 말로 설명하게 한다.
// - 페이지가 주는 핵심 값: 대상이 있는 화면(사용자·역할·프로젝트)은 focus, 대상 없이 상태만 있는 화면(SSO·알림·프로필)은 scope.facts 앞쪽.
//   대상 없는 화면을 focus 로 두면 칩이 「설정 · …」 대신 값 문구로 바뀌어 사용자가 어느 화면 맥락인지 알기 어렵다.
// - 페이지는 비밀값(비밀번호·토큰·시크릿)을 넘기지 않는다 — 넘기는 값은 각 페이지가 고른 리터럴 라벨뿐이라 여기서 라벨로 다시 거르지 않는다.
import type { SettingsGuide } from '@/components/settings-guide/types';
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, type FactValue, LIMITS } from '../common';

/** 대상이 있는 설정 화면의 focus 입력 — 데이터가 로드된 뒤에만 넘긴다(미로드 값은 보내지 않는다). */
export interface SettingsFocusInput {
  /** 대상 종류 — 예: '사용자', '역할', '프로젝트' */
  type: string;
  /** 대상 이름 — 비면 focus 를 싣지 않는다(서버가 빈 label 을 거절). */
  label: string;
  /** MCP 도구 인자명 키(username, projectKey 등). */
  refs?: Record<string, string | number | null | undefined>;
  facts?: Array<[string, FactValue]>;
}

/** 페이지가 SettingsPage 에 넘기는 화면 값 — focus(대상) 와 facts(상태 값) 중 화면에 맞는 쪽을 쓴다. */
export interface SettingsAiContextInput {
  focus?: SettingsFocusInput | null;
  /** 대상 없는 화면의 현재 상태 값 — 가이드 요약보다 앞에 둔다(상한 초과 시 뒤쪽이 요약된다). */
  facts?: Array<[string, FactValue]>;
}

/** 가이드 요약 — 소개 → 주의(되돌리기 어려운 동작, 영향이 커 앞쪽) → 알아두기 순. */
function guidePairs(guide: SettingsGuide): Array<[string, FactValue]> {
  return [
    ['소개', guide.lead],
    ['주의', guide.caution],
    ...guide.tips.map((tip, i): [string, FactValue] => [`알아두기 ${i + 1}`, tip]),
  ];
}

/** 설정 화면 컨텍스트 — guide 의 제목·요약 + 페이지 값(선택). */
export function buildSettingsScreenContext(guide: SettingsGuide, extra?: SettingsAiContextInput | null): AiScreenContext {
  const view = clip(`설정 · ${guide.title}`, LIMITS.view);
  const ctx: AiScreenContext = {
    view,
    scope: {
      // 범위 라벨에 화면 이름을 그대로 둬 칩이 「설정 · <제목>」 한 번만 보이게 한다(chipLabel 중복 회피 규칙).
      label: clip(view, LIMITS.label),
      facts: buildFacts([...(extra?.facts ?? []), ...guidePairs(guide)], { overflowLabel: '그 밖의 안내' }),
    },
  };
  const f = extra?.focus;
  const label = f?.label.trim();
  if (f && label) {
    const facts = buildFacts(f.facts ?? []);
    ctx.focus = {
      type: clip(f.type, LIMITS.type),
      label: clip(label, LIMITS.label),
      refs: buildRefs(f.refs ?? {}),
      ...(facts ? { facts } : {}),
    };
  }
  return ctx;
}
