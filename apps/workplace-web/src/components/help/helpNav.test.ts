// 도움말 판정(helpNav) — 주소에 맞는 장, 관리자 장 숨김, 절 층·브레드크럼·관련 목록, 이동 기록 reducer 를 순수 함수로 지킨다(WP-1505).
// 패널 화면 테스트보다 먼저 경계(맞는 장 없음 → 목차, 일반 구성원에게 관리자 장 안 보임)를 여기서 고정한다.
import { describe, expect, it } from 'vitest'

import { appLabelForPath } from '@/components/layout/appRailModules'

import type { HelpIndexChapter, HelpIndexSection } from './helpBundle'
import {
  findSection,
  helpBreadcrumb,
  helpNavReducer,
  type HelpNavState,
  isChapterVisible,
  matchChapterForPath,
  relatedSections,
  resolveHelpView,
  sectionAncestors,
  sectionName,
  sectionTree,
} from './helpNav'

/** 절 픽스처 — parent 는 도움말 id 기준이라 id 없는 절(`<chapter>#…`)은 건너뛴다(생성기와 같은 규칙). */
const sec = (id: string, level: number, title: string, label: string, parent: string | null): HelpIndexSection => ({
  id,
  level,
  title,
  label,
  parent,
})

const home: HelpIndexChapter = {
  chapter: 'home',
  number: 3,
  title: '홈',
  routes: ['/'],
  audience: ['member', 'admin'],
  sections: [sec('home#_intro', 1, '홈', '홈', null), sec('home.feed', 2, '피드를 본다', '피드', null)],
}

const agents: HelpIndexChapter = {
  chapter: 'agents',
  number: 20,
  title: 'AI 에이전트 관리',
  routes: ['/settings/agents', '/settings/agents/:id'],
  audience: ['admin'],
  sections: [
    sec('agents#_intro', 1, 'AI 에이전트 관리', 'AI 에이전트 관리', null),
    sec('agents#run', 2, '실행', '실행', null),
    sec('agent.run.repo', 3, '저장소를 연결한다', '저장소 연결', null),
    sec('agent.run.repo.token', 4, '토큰을 넣는다', '토큰을 넣는다', 'agent.run.repo'),
    sec('agents#limits', 2, '한계', '한계', null),
  ],
}

/** 넓은 경로를 가진 일반 장 — 구체적인 관리자 장 경로와 다툰다. */
const settings: HelpIndexChapter = {
  chapter: 'settings',
  number: 10,
  title: '설정',
  routes: ['/settings/*'],
  audience: ['member'],
  sections: [sec('settings#_intro', 1, '설정', '설정', null)],
}

const glossary: HelpIndexChapter = {
  chapter: 'glossary',
  number: 99,
  title: '용어',
  routes: [],
  audience: [],
  sections: [sec('glossary#_intro', 1, '용어', '용어', null)],
}

const index = [home, settings, agents, glossary]

describe('장 보이기·주소 매칭', () => {
  it('관리자 장은 일반 구성원에게 보이지 않는다', () => {
    expect(isChapterVisible({ audience: ['admin'] }, false)).toBe(false)
    expect(isChapterVisible({ audience: ['admin'] }, true)).toBe(true)
    expect(isChapterVisible({ audience: [] }, false)).toBe(true)
    expect(isChapterVisible({ audience: ['member', 'admin'] }, false)).toBe(true)
  })

  it('주소에 맞는 장 — 구체적인 경로가 이긴다', () => {
    expect(matchChapterForPath(index, '/settings/agents/7', true)?.chapter).toBe('agents')
    expect(matchChapterForPath(index, '/settings/agents', true)?.chapter).toBe('agents')
    expect(matchChapterForPath(index, '/', false)?.chapter).toBe('home')
  })

  it('구성원에게는 관리자 장 주소도 매칭하지 않는다', () => {
    expect(matchChapterForPath([home, agents], '/settings/agents', false)).toBeNull()
    // 넓은 일반 장이 있으면 그쪽으로 떨어진다
    expect(matchChapterForPath(index, '/settings/agents/7', false)?.chapter).toBe('settings')
  })

  it('맞는 장이 없으면 null, routes 가 빈 장은 어느 주소와도 맞지 않는다', () => {
    expect(matchChapterForPath(index, '/nowhere', true)).toBeNull()
  })
})

describe('보일 내용', () => {
  it('맞는 장이 없으면 toc', () => {
    expect(resolveHelpView({ index, pathname: '/nowhere', selected: null, isAdmin: true })).toEqual({ kind: 'toc' })
  })

  it('주소만 있으면 장 첫머리', () => {
    expect(resolveHelpView({ index, pathname: '/', selected: null, isAdmin: false })).toEqual({
      kind: 'section',
      target: { chapter: 'home', sectionId: 'home#_intro' },
    })
  })

  it('고른 절이 있으면 주소보다 먼저', () => {
    const selected = { chapter: 'glossary', sectionId: 'glossary#_intro' }
    expect(resolveHelpView({ index, pathname: '/', selected, isAdmin: false })).toEqual({ kind: 'section', target: selected })
  })

  it('고른 절이 안 보이는 장·없는 절이면 주소의 장으로', () => {
    const expected = { kind: 'section', target: { chapter: 'home', sectionId: 'home#_intro' } }
    expect(
      resolveHelpView({ index, pathname: '/', selected: { chapter: 'agents', sectionId: 'agent.run.repo' }, isAdmin: false }),
    ).toEqual(expected)
    expect(resolveHelpView({ index, pathname: '/', selected: { chapter: 'home', sectionId: 'nope' }, isAdmin: false })).toEqual(
      expected,
    )
  })
})

describe('절 층', () => {
  it('sectionName 은 label(생성기가 늘 채운다), 비었으면 title', () => {
    expect(sectionName({ label: '저장소 연결', title: '저장소를 연결한다' })).toBe('저장소 연결')
    expect(sectionName({ label: '', title: '토큰을 넣는다' })).toBe('토큰을 넣는다')
  })

  it('findSection 은 장과 절을 함께 찾는다', () => {
    const found = findSection(index, 'agents#_intro')
    expect(found?.chapter.chapter).toBe('agents')
    expect(found?.section.title).toBe('AI 에이전트 관리')
    expect(findSection(index, 'nope')).toBeNull()
  })

  it('조상은 level 로 올라간다', () => {
    expect(sectionAncestors(agents, 'agent.run.repo.token').map((s) => s.id)).toEqual([
      'agents#_intro',
      'agents#run',
      'agent.run.repo',
    ])
    expect(sectionAncestors(agents, 'agents#limits').map((s) => s.id)).toEqual(['agents#_intro'])
    expect(sectionAncestors(agents, 'agents#_intro')).toEqual([])
  })

  it('sectionTree 의 depth 는 level − 1', () => {
    expect(sectionTree(agents).map((t) => [t.section.id, t.depth])).toEqual([
      ['agents#_intro', 0],
      ['agents#run', 1],
      ['agent.run.repo', 2],
      ['agent.run.repo.token', 3],
      ['agents#limits', 1],
    ])
  })

  it('브레드크럼은 앱 이름부터 화면 칸 이름(label)으로', () => {
    const crumbs = helpBreadcrumb(index, { chapter: 'agents', sectionId: 'agent.run.repo' }, '/settings/agents/7')
    expect(crumbs.map((c) => c.label)).toEqual(['설정', 'AI 에이전트 관리', '실행', '저장소 연결'])
    expect(crumbs[0].target).toBeNull()
    expect(crumbs[1].target).toEqual({ chapter: 'agents', sectionId: 'agents#_intro' })
    // 키는 겹치지 않는다(React key)
    expect(new Set(crumbs.map((c) => c.key)).size).toBe(crumbs.length)
  })

  it('앱 이름이 없는 주소면 앱 칸을 뺀다', () => {
    const crumbs = helpBreadcrumb(index, { chapter: 'glossary', sectionId: 'glossary#_intro' }, '/nowhere')
    expect(crumbs.map((c) => c.label)).toEqual(['용어'])
  })

  it('관련은 없는 id·안 보이는 장을 뺀다', () => {
    expect(relatedSections(index, ['agent.run.repo', 'nope', 'home#_intro'], false, 'home.feed').map((r) => r.section.id)).toEqual([
      'home#_intro',
    ])
    expect(relatedSections(index, ['agent.run.repo', 'home#_intro'], true, 'home.feed').map((r) => r.section.id)).toEqual([
      'agent.run.repo',
      'home#_intro',
    ])
  })

  it('관련은 같은 id 를 한 번만, 지금 보는 절 자신은 빼고 보인다', () => {
    const links = ['home#_intro', 'home.feed', 'home#_intro', 'settings#_intro', 'home.feed']
    expect(relatedSections(index, links, false, 'home.feed').map((r) => r.section.id)).toEqual(['home#_intro', 'settings#_intro'])
  })
})

describe('이동 기록', () => {
  it('고르면 쌓이고 뒤로 가면 꺼내며 주소가 바뀌면 비운다', () => {
    const intro = { chapter: 'agents', sectionId: 'agents#_intro' }
    const repo = { chapter: 'agents', sectionId: 'agent.run.repo' }
    let s: HelpNavState = { pathname: '/settings/agents/7', selected: null, history: [] }

    s = helpNavReducer(s, { type: 'select', target: repo, from: intro })
    expect(s.selected).toEqual(repo)
    expect(s.history).toEqual([intro])

    s = helpNavReducer(s, { type: 'back' })
    expect(s.selected).toEqual(intro)
    expect(s.history).toEqual([])

    // 기록이 비었을 때 뒤로는 그대로
    expect(helpNavReducer(s, { type: 'back' })).toBe(s)

    s = helpNavReducer(s, { type: 'select', target: repo, from: intro })
    // 같은 경로면 그대로
    expect(helpNavReducer(s, { type: 'route', pathname: '/settings/agents/7' })).toBe(s)

    s = helpNavReducer(s, { type: 'route', pathname: '/' })
    expect(s).toEqual({ pathname: '/', selected: null, history: [] })
  })

  it('from 이 없거나 같은 절을 고르면 기록에 쌓지 않는다', () => {
    const repo = { chapter: 'agents', sectionId: 'agent.run.repo' }
    const s0: HelpNavState = { pathname: '/', selected: null, history: [] }
    expect(helpNavReducer(s0, { type: 'select', target: repo, from: null }).history).toEqual([])
    expect(helpNavReducer(s0, { type: 'select', target: repo, from: { ...repo } }).history).toEqual([])
  })
  it('화면을 따라 보던 절(followed)로 뒤로 돌아가면 고정하지 않고 다시 화면을 따른다', () => {
    const a = { chapter: 'agents', sectionId: 'agents#_intro' }
    const b = { chapter: 'agents', sectionId: 'agents#run' }
    const c = { chapter: 'agents', sectionId: 'agent.run.repo' }
    let s: HelpNavState = { pathname: '/settings/agents/7', selected: null, history: [] }

    s = helpNavReducer(s, { type: 'select', target: b, from: { ...a, followed: true } })
    expect(s.history).toEqual([{ ...a, followed: true }])
    s = helpNavReducer(s, { type: 'select', target: c, from: b })
    s = helpNavReducer(s, { type: 'back' })
    expect(s.selected).toEqual(b)
    s = helpNavReducer(s, { type: 'back' })
    expect(s.selected).toBeNull()
    expect(s.history).toEqual([])
  })

  it('release 는 고른 절과 기록을 비우고, 이미 비었으면 같은 상태를 돌려준다', () => {
    const a = { chapter: 'agents', sectionId: 'agents#_intro' }
    const b = { chapter: 'agents', sectionId: 'agents#run' }
    let s: HelpNavState = { pathname: '/', selected: null, history: [] }
    expect(helpNavReducer(s, { type: 'release' })).toBe(s)
    s = helpNavReducer(s, { type: 'select', target: b, from: a })
    s = helpNavReducer(s, { type: 'release' })
    expect(s).toEqual({ pathname: '/', selected: null, history: [] })
  })
})

describe('appLabelForPath', () => {
  it('레일 모듈 표의 첫 활성 모듈 이름', () => {
    expect(appLabelForPath('/settings/agents/7')).toBe('설정')
    expect(appLabelForPath('/admin/users')).toBe('설정')
    expect(appLabelForPath('/me/tasks/assigned')).toBe('작업 관리')
    expect(appLabelForPath('/')).toBe('홈')
    expect(appLabelForPath('/nowhere')).toBeNull()
  })
})
