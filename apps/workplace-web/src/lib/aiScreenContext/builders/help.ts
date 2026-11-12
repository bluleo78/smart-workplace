// 도움말 층 빌더(WP-1511) — 도움말 패널이 보던 절·포커스 칸·열린 창·검색어를 AI 화면 참고용 AiHelpContext 로 만든다.
// 순수 함수라 화면·DOM 을 모른다. 본문은 패널이 그리는 것과 같은 순서(조건 처리 → 자리표시 채움)로 다듬은 뒤 상한으로 자른다.
// 비밀값 칸은 이름과 secret 표식만 싣고 value 키 자체를 만들지 않는다 — 값이 AI·서버로 새지 않게 하는 마지막 방어선.
import type { HelpVars } from '@/components/help/helpBundle'
import type { HelpFieldInfo } from '@/components/help/helpFieldInfo'
import { applyHelpConditions, fillHelpSnippet, type HelpValues } from '@/components/help/helpMarkup'
import type { AiHelpContext } from '@/types/aiScreenContext'

import { clip, LIMITS } from '../common'

/** 도움말 층 빌더 입력 — section 은 보던 절(없으면 목차·받는 중), 나머지는 화면 신호. */
export interface HelpContextInput {
  section: { id: string; path: string[]; markdown: string } | null
  values: HelpValues
  vars: HelpVars | null
  focus: HelpFieldInfo | null
  dialog: string | null
  query: string
}

/**
 * 도움말 층 값을 만든다. 모든 문자열은 LIMITS.help* 상한으로 자르고(앞뒤 공백 제거), 빈 값 키는 뺀다. 모두 비면 null.
 * 본문은 조건 블록 처리 → 자리표시 채움(값 없으면 <표시 이름>) → 상한 자르기 순서다.
 */
export function buildHelpContext(input: HelpContextInput): AiHelpContext | null {
  const out: AiHelpContext = {}

  const { section } = input
  if (section) {
    const id = clip(section.id, LIMITS.helpId)
    if (id) {
      const body = clip(fillHelpSnippet(applyHelpConditions(section.markdown, input.values.conditions, input.vars), input.values, input.vars), LIMITS.helpBody)
      const path = section.path.slice(0, LIMITS.helpPath).map((p) => clip(p, LIMITS.helpPathItem)).filter(Boolean)
      out.section = { id, path, body }
    }
  }

  const { focus } = input
  if (focus) {
    const name = clip(focus.name, LIMITS.helpFocusName)
    if (name) {
      if (focus.secret) out.focus = { name, secret: true }
      else {
        const value = clip(focus.value ?? '', LIMITS.helpFocusValue)
        out.focus = value ? { name, value } : { name }
      }
    }
  }

  const dialog = clip(input.dialog ?? '', LIMITS.helpDialog)
  if (dialog) out.dialog = dialog
  const query = clip(input.query, LIMITS.helpQuery)
  if (query) out.query = query

  return Object.keys(out).length > 0 ? out : null
}
