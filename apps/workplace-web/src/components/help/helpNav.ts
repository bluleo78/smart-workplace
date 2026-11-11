// 도움말 패널이 무엇을 보일지 고르는 순수 판정(WP-1505).
// 주소 → 장, 관리자 장 숨김, 절 층(조상·트리)·브레드크럼·관련 목록, 고른 절과 뒤로 기록(reducer)을 화면과 떼어 두어
// 경계(맞는 장 없음 → 목차, 일반 구성원에게 관리자 장 안 보임)를 vitest 로 지킨다.
import { matchRoutes } from 'react-router-dom'

import { appLabelForPath } from '@/components/layout/appRailModules'

import type { HelpIndexChapter, HelpIndexSection } from './helpBundle'

/** 패널이 가리키는 절 — 장 파일을 받으려면 장 이름이, 절을 고르려면 id 가 필요해 둘을 함께 든다. */
export type HelpTarget = { chapter: string; sectionId: string }

/** 장과 그 안의 절 한 쌍(찾기·관련 목록 결과). */
export type HelpSectionRef = { chapter: HelpIndexChapter; section: HelpIndexSection }

/**
 * 브레드크럼·목록에 보일 이름 — 화면 칸 이름(label)(설계 14절). 생성기가 label 을 늘 채우지만(표시 label, 없으면 제목)
 * 묶음 형식 밖 빈 글자가 와도 칸이 비지 않게 제목으로 대신한다.
 */
export function sectionName(s: { label: string; title: string }): string {
  return s.label || s.title
}

/**
 * 이 사용자에게 장이 보이는가. audience 가 비었거나 `member` 가 있으면 누구에게나, `admin` 은 관리자에게만.
 * 관리자 장은 「보이지만 않게」 거르는 것이다 — 정적 파일 받기는 막지 않는다(권한 경계가 아니라 목록 정리).
 */
export function isChapterVisible(ch: { audience: string[] }, isAdmin: boolean): boolean {
  if (ch.audience.length === 0) return true
  if (ch.audience.includes('member')) return true
  return isAdmin && ch.audience.includes('admin')
}

/**
 * 주소에 맞는 장 — 보이는 장의 routes 를 react-router matchRoutes 에 한꺼번에 넣어 가장 구체적인 경로가 이기게 한다
 * (예: `/settings/*` 보다 `/settings/agents/:id`). 앱 라우트와 같은 규칙이라 매뉴얼 프론트매터 경로를 그대로 쓸 수 있다.
 */
export function matchChapterForPath(index: HelpIndexChapter[], pathname: string, isAdmin: boolean): HelpIndexChapter | null {
  const routes = index
    .filter((ch) => isChapterVisible(ch, isAdmin))
    .flatMap((ch) => ch.routes.map((path) => ({ path, chapter: ch })))
  if (routes.length === 0) return null
  const matches = matchRoutes(routes, pathname)
  return matches?.[matches.length - 1]?.route.chapter ?? null
}

/** 도움말 id 로 절을 찾는다(장 보이기는 보지 않는다 — 호출하는 쪽이 거른다). */
export function findSection(index: HelpIndexChapter[], id: string): HelpSectionRef | null {
  for (const chapter of index) {
    const section = chapter.sections.find((s) => s.id === id)
    if (section) return { chapter, section }
  }
  return null
}

/**
 * 절의 조상(첫머리 절이 맨 앞, 자기 제외) — 문서 순서에서 자기보다 level 이 작은 가장 가까운 앞 절을 거슬러 올라간다.
 * `parent`(도움말 id 기준) 대신 level 을 쓰는 이유: id 없는 절(`<chapter>#<slug>`)도 층이 있어 parent 로는 그 단계가 빠진다.
 */
export function sectionAncestors(chapter: HelpIndexChapter, id: string): HelpIndexSection[] {
  const at = chapter.sections.findIndex((s) => s.id === id)
  if (at < 0) return []
  const out: HelpIndexSection[] = []
  let level = chapter.sections[at].level
  for (let i = at - 1; i >= 0 && level > 1; i--) {
    const s = chapter.sections[i]
    if (s.level < level) {
      out.unshift(s)
      level = s.level
    }
  }
  return out
}

/** 장의 절을 문서 순서대로 들여쓰기 깊이(level − 1)와 함께 — ⌄ 「이 화면」 목록. */
export function sectionTree(chapter: HelpIndexChapter): { section: HelpIndexSection; depth: number }[] {
  return chapter.sections.map((section) => ({ section, depth: Math.max(0, section.level - 1) }))
}

/**
 * 「관련」 목록 — 본문이 가리키는 절 가운데 묶음에 있고 이 사용자에게 보이는 장의 것만(링크 순서 유지).
 * 같은 절을 여러 번 가리켜도 한 번만(React key 도 겹치지 않게), 지금 보는 절(selfId) 자신은 뺀다 — 눌러도 제자리라서.
 */
export function relatedSections(index: HelpIndexChapter[], links: string[], isAdmin: boolean, selfId: string): HelpSectionRef[] {
  const ids = [...new Set(links)].filter((id) => id !== selfId)
  return ids
    .map((id) => findSection(index, id))
    .filter((ref): ref is HelpSectionRef => ref !== null && isChapterVisible(ref.chapter, isAdmin))
}

/** 브레드크럼 한 칸 — target 이 null 이면 누를 수 없는 칸(앱 이름). */
export type HelpCrumb = { key: string; label: string; target: HelpTarget | null }

/**
 * 브레드크럼 — [앱 이름(레일 모듈, 누를 수 없음), …조상, 현재]. 앱 이름이 없는 주소면 그 칸을 뺀다.
 * 절을 찾지 못하면 앱 이름만 남는다(패널은 그 경우 목차를 보이므로 브레드크럼을 쓰지 않는다).
 * 장 보이기(관리자 장)는 보지 않는다 — 호출하는 쪽이 resolveHelpView 로 거른 target 을 넘긴다.
 */
export function helpBreadcrumb(index: HelpIndexChapter[], target: HelpTarget, pathname: string): HelpCrumb[] {
  const crumbs: HelpCrumb[] = []
  const app = appLabelForPath(pathname)
  if (app !== null) crumbs.push({ key: 'app', label: app, target: null })
  const chapter = index.find((ch) => ch.chapter === target.chapter)
  const section = chapter?.sections.find((s) => s.id === target.sectionId)
  if (!chapter || !section) return crumbs
  for (const s of [...sectionAncestors(chapter, section.id), section]) {
    crumbs.push({ key: s.id, label: sectionName(s), target: { chapter: chapter.chapter, sectionId: s.id } })
  }
  return crumbs
}

/** 패널 본문에 보일 것 — 절 하나, 또는 목차. */
export type HelpView = { kind: 'section'; target: HelpTarget } | { kind: 'toc' }

/** 고른 절이 묶음에 있고 이 사용자에게 보이는가(주소가 바뀌기 전 고른 것이 권한·묶음 변화로 사라졌을 수 있다). */
function isTargetVisible(index: HelpIndexChapter[], target: HelpTarget, isAdmin: boolean): boolean {
  const chapter = index.find((ch) => ch.chapter === target.chapter)
  return !!chapter && isChapterVisible(chapter, isAdmin) && chapter.sections.some((s) => s.id === target.sectionId)
}

/** 보일 내용 — 고른 절(보이면) > 주소에 맞는 장의 첫머리 > 목차. */
export function resolveHelpView(a: {
  index: HelpIndexChapter[]
  pathname: string
  selected: HelpTarget | null
  isAdmin: boolean
}): HelpView {
  if (a.selected && isTargetVisible(a.index, a.selected, a.isAdmin)) return { kind: 'section', target: a.selected }
  const chapter = matchChapterForPath(a.index, a.pathname, a.isAdmin)
  const first = chapter?.sections[0]
  if (chapter && first) return { kind: 'section', target: { chapter: chapter.chapter, sectionId: first.id } }
  return { kind: 'toc' }
}

/** 패널 이동 상태 — 주소, 사용자가 고른 절(null 이면 주소의 장 첫머리), 뒤로 기록(가장 최근이 끝). */
export type HelpNavState = { pathname: string; selected: HelpTarget | null; history: HelpTarget[] }

export type HelpNavAction =
  | { type: 'route'; pathname: string }
  | { type: 'select'; target: HelpTarget; from: HelpTarget | null }
  | { type: 'back' }

const sameTarget = (a: HelpTarget, b: HelpTarget) => a.chapter === b.chapter && a.sectionId === b.sectionId

/**
 * 이동 reducer.
 * - route: 주소가 바뀌면 고른 절·기록을 비운다 — 새 화면의 도움말을 보여야 하고, 옛 화면의 기록으로 돌아가면 어긋난다. 같은 주소면 그대로.
 * - select: 보던 절(from)이 있고 고른 절과 다르면 기록에 쌓는다.
 * - back: 기록 끝을 꺼내 고른 절로. 기록이 비면 그대로.
 */
export function helpNavReducer(s: HelpNavState, a: HelpNavAction): HelpNavState {
  switch (a.type) {
    case 'route':
      return a.pathname === s.pathname ? s : { pathname: a.pathname, selected: null, history: [] }
    case 'select': {
      const push = a.from !== null && !sameTarget(a.from, a.target)
      return { ...s, selected: a.target, history: push && a.from ? [...s.history, a.from] : s.history }
    }
    case 'back': {
      if (s.history.length === 0) return s
      return { ...s, selected: s.history[s.history.length - 1], history: s.history.slice(0, -1) }
    }
  }
}
