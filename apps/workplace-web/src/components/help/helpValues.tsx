// 도움말 자리표시·조건 값의 등록과 읽기(WP-1505).
// 매뉴얼 본문의 `{agent.username}`·`{if app.customMcpServer}` 같은 표기는 지금 보는 화면만 아는 값으로 채운다.
// 화면(페이지)은 useProvideHelpValues 로 값을 등록하고, 도움말 패널은 useHelpValues 로 읽는다 — 패널이 화면 데이터를
// 직접 조회하지 않게 하려고(화면마다 다른 훅·권한). 등록 장소는 모듈 스토어 하나라 Provider 를 끼우지 않아도 된다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { MCP_ENDPOINT } from '@/lib/mcpEndpoint'
import { needsServerUrlSetting } from '@/lib/pluginGuide'

import type { HelpValues } from './helpMarkup'

export type { HelpValues } from './helpMarkup'

// 등록된 값 — 등록 순서(Map 삽입 순서)대로 덮어 나중에 마운트한 화면이 이긴다.
const entries = new Map<number, Partial<HelpValues>>()
const listeners = new Set<() => void>()
let nextId = 0

/** 등록 값을 순서대로 합친 것. useSyncExternalStore 가 같은 참조를 받도록 바뀔 때만 새로 만든다. */
let snapshot: HelpValues = { placeholders: {}, conditions: {} }

// 등록이 바뀌면 합친 값을 다시 만들고 구독자에게 알린다.
function notify(): void {
  const merged: HelpValues = { placeholders: {}, conditions: {} }
  for (const v of entries.values()) {
    Object.assign(merged.placeholders, v.placeholders)
    Object.assign(merged.conditions, v.conditions)
  }
  snapshot = merged
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * 값을 바뀜 감지용 문자열로 — 화면이 렌더마다 새 객체를 넘겨도 내용이 같으면 다시 등록하지 않게(등록은 원래 값으로 한다).
 * 「값 없음(undefined)」이 다른 값으로 바뀐 것도 알아야 해서 null 로 적어 둔다(JSON 은 undefined 칸을 빼 버린다).
 */
function serialize(values: Partial<HelpValues>): string {
  const pairs = (r: Record<string, unknown> | undefined) => Object.entries(r ?? {}).map(([k, v]) => [k, v ?? null])
  return JSON.stringify([pairs(values.placeholders), pairs(values.conditions)])
}

/**
 * 이 화면이 아는 도움말 값을 마운트 동안 등록한다(언마운트 시 지움). 여러 화면이 같은 이름을 주면 나중에 마운트한 쪽이 이긴다.
 * 값이 아직 없으면(로딩 중) undefined 로 넘긴다 — 패널은 그동안 `<AI 아이디>` 꼴로 보인다.
 */
export function useProvideHelpValues(values: Partial<HelpValues>): void {
  const [id] = useState(() => ++nextId)
  const key = serialize(values)
  // 마지막 렌더의 값 — 등록 효과는 내용이 바뀔 때(key)만 돌고, 그때 이 값을 그대로 등록한다(문자열을 다시 객체로 풀지 않는다).
  // 레이아웃 효과에서 갱신해 렌더 중에 ref 를 쓰지 않으면서도 아래 등록 효과보다 먼저 맞춰 둔다.
  const latest = useRef(values)
  useLayoutEffect(() => {
    latest.current = values
  })
  // 값이 바뀌면 같은 자리(등록 순서 유지)에 덮어쓴다.
  useEffect(() => {
    entries.set(id, latest.current)
    notify()
  }, [id, key])
  // 언마운트 때만 지운다 — 값 변경마다 지웠다 다시 넣으면 등록 순서가 바뀐다.
  useEffect(
    () => () => {
      entries.delete(id)
      notify()
    },
    [id],
  )
}

/**
 * 지금 도움말 값 — 앱 기본값(앱 주소·MCP 주소·기본 주소가 아닌 서버인지) 위에 화면이 등록한 값을 덮는다.
 * 기본값은 어느 화면에서나 같은 값이라 화면이 등록하지 않아도 채워진다.
 */
export function useHelpValues(): HelpValues {
  const registered = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
  return useMemo(
    () => ({
      placeholders: { 'app.origin': window.location.origin, 'app.mcpEndpoint': MCP_ENDPOINT, ...registered.placeholders },
      conditions: { 'app.customMcpServer': needsServerUrlSetting(MCP_ENDPOINT), ...registered.conditions },
    }),
    [registered],
  )
}
