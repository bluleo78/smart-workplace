// 설정 화면 컨텍스트 builder(WP-414) — 설정 화면에서 AI 가 「이 설정」 이 무엇인지 알게 한다.
// - 화면 설명은 매뉴얼 도움말 절이 가진다(WP-1507·1508) — 대표 절 요약(helpSummaryPairs)을 scope.facts 에 실어 AI 가 화면 규칙을 매뉴얼과 같은 말로 설명하게 한다.
// - view 「설정 · <화면 이름>」.
// - 페이지가 주는 핵심 값: 대상이 있는 화면(사용자·역할·프로젝트)은 focus, 대상 없이 상태만 있는 화면(SSO·알림·프로필)은 scope.facts 앞쪽.
//   대상 없는 화면을 focus 로 두면 칩이 「설정 · …」 대신 값 문구로 바뀌어 사용자가 어느 화면 맥락인지 알기 어렵다.
// - 페이지는 비밀값(비밀번호·토큰·시크릿)을 넘기지 않는다 — 넘기는 값은 각 페이지가 고른 리터럴 라벨뿐이라 여기서 라벨로 다시 거르지 않는다.
import type { HelpSummaryItem } from '@/components/help/manualSummary';
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
  /** 대상 없는 화면의 현재 상태 값 — 도움말 요약보다 앞에 둔다(상한 초과 시 뒤쪽이 요약된다). */
  facts?: Array<[string, FactValue]>;
}

/**
 * WP-1507: 매뉴얼 도움말 절 요약(summarizeHelpSection) → facts 쌍. 글 항목은 그대로, 표 항목은 행을 `; ` 로 이어 한 칸 상한
 * (LIMITS.factValue)을 넘기 전에 끊고 「라벨 2」… 로 나눈다 — 뒤 행의 뜻이 말줄임에 잘려 사라지지 않게.
 * 행 하나가 상한보다 길면 그 행만 한 칸에 두고, 말줄임은 buildFacts 가 한다. summary 가 null(아직 못 받음)이면 빈 목록.
 */
export function helpSummaryPairs(summary: HelpSummaryItem[] | null): Array<[string, FactValue]> {
  const out: Array<[string, FactValue]> = [];
  for (const item of summary ?? []) {
    if ('text' in item) {
      out.push([item.label, item.text]);
      continue;
    }
    // 표 하나를 상한 안 칸들로 — 둘째 칸부터 「라벨 n」.
    let n = 0;
    let chunk = '';
    const flush = () => {
      if (!chunk) return;
      n += 1;
      out.push([n === 1 ? item.label : `${item.label} ${n}`, chunk]);
      chunk = '';
    };
    for (const row of item.rows) {
      const next = chunk ? `${chunk}; ${row}` : row;
      if (chunk && next.length > LIMITS.factValue) {
        flush();
        chunk = row;
      } else chunk = next;
    }
    flush();
  }
  return out;
}

/**
 * 설정 화면 컨텍스트 — 화면 이름과 요약 쌍(helpSummaryPairs)에 페이지 값(선택)을 얹는다.
 * 페이지 값(facts)을 요약보다 앞에 둔다 — 상한(LIMITS.facts)을 넘으면 뒤쪽 요약이 「그 밖의 안내」로 줄어든다.
 * 요약이 비면(도움말 요약을 아직 못 받음 등) 화면 이름과 페이지 값만 싣는다 — 받지 않은 설명을 지어 넣지 않는다.
 */
export function buildSettingsScreenContext(
  title: string,
  pairs: Array<[string, FactValue]>,
  extra?: SettingsAiContextInput | null,
): AiScreenContext {
  const view = clip(`설정 · ${title}`, LIMITS.view);
  const facts = buildFacts([...(extra?.facts ?? []), ...pairs], { overflowLabel: '그 밖의 안내' });
  const ctx: AiScreenContext = {
    view,
    scope: {
      // 범위 라벨에 화면 이름을 그대로 둬 칩이 「설정 · <제목>」 한 번만 보이게 한다(chipLabel 중복 회피 규칙).
      label: clip(view, LIMITS.label),
      // 실을 값이 없으면(요약을 아직 못 받음 등) 키를 빼 「빈 목록」으로 오해시키지 않는다.
      ...(facts ? { facts } : {}),
    },
  };
  const f = extra?.focus;
  const label = f?.label.trim();
  if (f && label) {
    const focusFacts = buildFacts(f.facts ?? []);
    ctx.focus = {
      type: clip(f.type, LIMITS.type),
      label: clip(label, LIMITS.label),
      refs: buildRefs(f.refs ?? {}),
      ...(focusFacts ? { facts: focusFacts } : {}),
    };
  }
  return ctx;
}
