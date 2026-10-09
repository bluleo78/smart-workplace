// 노트 멘션 칩 라벨 조회 — 문서엔 mtype·id 만 있으므로(WP-294) 화면이 라벨을 채운다.
// 소스: ① 페이지 멘션 해소 API(useWikiMentions) ② 이 탭에서 방금 삽입한 멘션(제안 목록·이슈 생성에서 고른 라벨).
// ②는 저장 → 멘션 재조회 전까지의 공백을 메운다. 둘 다 없으면 id 기반 대체 라벨.

import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react'

import { useWikiMentions } from '../../hooks/queries/useWikiMentions'
import type { WikiMentionType } from '../../types/wiki'

// 이 탭에서 삽입한 멘션의 라벨(mtype:id → label). 모듈 수명 동안 유지 — 같은 대상의 라벨은 페이지가 달라도 같다.
const localLabels = new Map<string, string>()
const key = (mtype: WikiMentionType, id: number) => `${mtype}:${id}`

/** 멘션을 넣을 때 라벨을 기억한다(다른 접속자 화면은 멘션 재조회로 채워진다). 삽입 직전에 호출해야 첫 렌더에 보인다. */
// eslint-disable-next-line react-refresh/only-export-components
export function rememberMentionLabel(mtype: WikiMentionType, id: number, label: string): void {
  localLabels.set(key(mtype, id), label)
}

const LabelsContext = createContext<Map<string, string>>(new Map())

/** 페이지 멘션 해소 결과를 칩 NodeView 에 내려 준다. EditorContent 를 감싸야 NodeView 포털이 컨텍스트를 받는다. */
export function WikiMentionLabelsProvider({ pageId, children }: { pageId: number; children: ReactNode }) {
  const { data } = useWikiMentions(pageId)
  const map = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data ?? []) m.set(key(r.type, r.id), r.label)
    return m
  }, [data])
  return <LabelsContext.Provider value={map}>{children}</LabelsContext.Provider>
}

/** 라벨 해소 — 해소 결과 > 로컬 기억 > 대체 라벨. 칩과 버전 비교 위젯이 같은 규칙을 쓴다. */
function resolveMentionLabel(map: Map<string, string>, mtype: WikiMentionType, id: number): string {
  const k = key(mtype, id)
  const found = map.get(k) ?? localLabels.get(k)
  if (found) return found
  return mtype === 'USER' ? `사용자 ${id}` : mtype === 'PAGE' ? `페이지 #${id}` : `이슈 #${id}`
}

/** 칩에 보일 글자 — USER 는 채팅 칩과 같은 "@" 접두, PAGE/ISSUE 는 참조 링크라 접두 없음(#703). */
// eslint-disable-next-line react-refresh/only-export-components
export function mentionChipText(mtype: WikiMentionType, label: string): string {
  return mtype === 'USER' ? `@${label}` : label
}

/** 칩에 보일 라벨 — 해소 결과 > 로컬 기억 > 대체 라벨. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMentionLabel(mtype: WikiMentionType, id: number): string {
  return resolveMentionLabel(useContext(LabelsContext), mtype, id)
}

/**
 * 멘션 대상 → 칩과 같은 글자를 돌려주는 함수(버전 비교의 추가 글자 위젯용, WP-324).
 * 위젯은 NodeView 가 아니라 훅을 못 쓰므로 함수로 넘긴다. 해소 결과가 도착하면 새 함수가 되어 호출자가 다시 그린다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMentionChipTextOf(): (mtype: WikiMentionType, id: number) => string {
  const map = useContext(LabelsContext)
  return useCallback((mtype, id) => mentionChipText(mtype, resolveMentionLabel(map, mtype, id)), [map])
}
