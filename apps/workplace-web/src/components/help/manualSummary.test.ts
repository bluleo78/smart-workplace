// 도움말 절 → 요약 항목(WP-1507) — 설정 화면이 매뉴얼 대표 절을 패널과 같은 글로 AI 에게 넘기는지 본다.
import { describe, expect, it } from 'vitest'

import type { HelpChapter, HelpSection, HelpVars } from './helpBundle'
import type { HelpValues } from './helpMarkup'
import { summarizeHelpSection } from './manualSummary'

/** 절 하나 — 본문 말고는 요약에 쓰지 않는 칸이라 고정값으로 채운다. */
function section(id: string, label: string, parent: string | null, markdown: string): HelpSection {
  return { id, label, title: label, parent, level: parent ? 3 : 2, markdown, figures: [], links: [] }
}

/** 절 목록으로 장 하나를 만든다. */
function chapter(sections: HelpSection[]): HelpChapter {
  return { chapter: 'agents', number: 15, title: 'AI 에이전트 관리', routes: [], audience: ['admin'], sections }
}

const noValues: HelpValues = { placeholders: {}, conditions: {} }
const vars: HelpVars = {
  placeholders: [{ name: 'agent.username', display: 'AI 아이디', description: '' }],
  conditions: [{ name: 'app.customMcpServer', tag: '(기본 주소가 아닌 서버만)', description: '' }],
}

describe('summarizeHelpSection', () => {
  it('소개 문단·주의·하위 절 첫 문단을 차례로 싣는다', () => {
    const md = [
      '첫 문단 **굵게**.',
      '',
      '> **주의**',
      '>',
      '> 지우면 못 되돌립니다.',
      '',
      '![그림](figure:x)',
      '',
      '```',
      '/cmd {agent.username}',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n')
    const ch = chapter([
      section('agent.run', '실행', null, md),
      section('agent.run.repo', '저장소 연결', 'agent.run', '[토큰](help:agent.run.repo.token) 을 붙입니다.\n\n둘째 문단.'),
      section('agent.run.keys', '접속 키', 'agent.run', '> **참고**\n>\n> 상자는 첫 문단이 아니다.\n\n키를 `발급` 합니다.'),
      section('other', '다른 절', null, '다른 장 본문.'),
    ])
    const facts = summarizeHelpSection(ch, 'agent.run', noValues, vars)
    expect(facts).toEqual([
      { label: '소개', text: '첫 문단 굵게.' },
      { label: '주의', text: '지우면 못 되돌립니다.' },
      // 표는 머리 첫 칸을 라벨로, 행마다 「첫 칸 — 나머지 칸」 으로 싣는다.
      { label: 'a', rows: ['1 — 2'] },
      { label: '저장소 연결', text: '토큰 을 붙입니다.' },
      { label: '접속 키', text: '키를 발급 합니다.' },
    ])
    const all = JSON.stringify(facts)
    expect(all).not.toContain('/cmd')
    expect(all).not.toContain('| a')
    expect(all).not.toContain('figure:')
  })

  it('자리표시는 값으로, 값이 없으면 <표시 이름>으로 채우고 날것 중괄호를 남기지 않는다', () => {
    const ch = chapter([section('agent', '에이전트 상세', null, '아이디는 {agent.username} 입니다.')])
    expect(summarizeHelpSection(ch, 'agent', { placeholders: { 'agent.username': 'dev5' }, conditions: {} }, vars)).toEqual([
      { label: '소개', text: '아이디는 dev5 입니다.' },
    ])
    expect(summarizeHelpSection(ch, 'agent', noValues, vars)).toEqual([{ label: '소개', text: '아이디는 <AI 아이디> 입니다.' }])
    const withoutVars = summarizeHelpSection(ch, 'agent', noValues, null)
    expect(withoutVars).toEqual([{ label: '소개', text: '아이디는 <agent.username> 입니다.' }])
  })

  it('조건 블록은 조건 값대로 남기거나 지운다', () => {
    const ch = chapter([section('agent', '에이전트 상세', null, '앞 문단.\n\n{if app.customMcpServer}\n주소를 바꿉니다.\n{/if}\n\n뒤 문단.')])
    const off = summarizeHelpSection(ch, 'agent', { placeholders: {}, conditions: { 'app.customMcpServer': false } }, vars)
    expect(off).toEqual([
      { label: '소개', text: '앞 문단.' },
      { label: '소개 2', text: '뒤 문단.' },
    ])
    const on = summarizeHelpSection(ch, 'agent', { placeholders: {}, conditions: { 'app.customMcpServer': true } }, vars)
    expect(on.map((i) => ('text' in i ? i.text : ''))).toEqual(['앞 문단.', '주소를 바꿉니다.', '뒤 문단.'])
  })

  it('목록 항목은 한 항목씩, HTML 주석은 뺀다', () => {
    const md = ['머리 문단.<!-- 근거: application.yml -->', '', '1. 첫 단계를 합니다.', '   이어지는 줄.', '2. 둘째 단계를 합니다.', '', '<!--', '여러 줄 주석', '-->', '- 글머리 항목'].join('\n')
    const ch = chapter([section('agent', '에이전트 상세', null, md)])
    expect(summarizeHelpSection(ch, 'agent', noValues, vars)).toEqual([
      { label: '소개', text: '머리 문단.' },
      { label: '소개 2', text: '첫 단계를 합니다. 이어지는 줄.' },
      { label: '소개 3', text: '둘째 단계를 합니다.' },
      { label: '소개 4', text: '글머리 항목' },
    ])
  })

  it('하위 절의 주의 상자는 「하위 절 · 주의」 로 위 절 주의 바로 뒤에 싣고, 하위 절 참고 상자는 싣지 않는다', () => {
    const ch = chapter([
      section('agents.locations', '실행 환경', null, '실행 환경 본문.\n\n> **참고**\n>\n> 위 절 참고.'),
      section('agents.locations.install', '연결 토큰', 'agents.locations', '설치 본문.\n\n> **참고**\n>\n> 하위 참고는 싣지 않는다.'),
      section(
        'agents.locations.menu',
        '실행 환경 메뉴',
        'agents.locations',
        '메뉴 본문.\n\n> **주의**\n>\n> 토큰을 재발급하면 옛 토큰은 바로 끊깁니다.',
      ),
    ])
    expect(summarizeHelpSection(ch, 'agents.locations', noValues, vars)).toEqual([
      { label: '소개', text: '실행 환경 본문.' },
      { label: '참고', text: '위 절 참고.' },
      { label: '실행 환경 메뉴 · 주의', text: '토큰을 재발급하면 옛 토큰은 바로 끊깁니다.' },
      { label: '연결 토큰', text: '설치 본문.' },
      { label: '실행 환경 메뉴', text: '메뉴 본문.' },
    ])
  })

  it('표는 머리 첫 칸을 라벨로, 행마다 「첫 칸 — 나머지」 글로 싣는다 — 나머지가 「—」 뿐이면 첫 칸만', () => {
    const md = [
      '계정 본문.',
      '',
      '| 상태 | 뜻 |',
      '| --- | --- |',
      '| **확인 필요** | 아직 확인하지 않았습니다 |',
      '| **한도 도달** | [한도](help:x)를 다 썼습니다 |',
      '| **종료됨** | — |',
      '| 글자 \\| 세로줄 | 뜻 |',
    ].join('\n')
    expect(summarizeHelpSection(chapter([section('agents.accounts', '계정', null, md)]), 'agents.accounts', noValues, vars)).toEqual([
      { label: '소개', text: '계정 본문.' },
      { label: '상태', rows: ['확인 필요 — 아직 확인하지 않았습니다', '한도 도달 — 한도를 다 썼습니다', '종료됨', '글자 | 세로줄 — 뜻'] },
    ])
  })

  it('인라인 코드 안의 * 는 기울임으로 보지 않고 그대로 둔다', () => {
    const ch = chapter([section('agent', '에이전트 상세', null, '기본 `*.md` 와 `*.txt` 파일을 *읽습니다*.')])
    expect(summarizeHelpSection(ch, 'agent', noValues, vars)).toEqual([{ label: '소개', text: '기본 *.md 와 *.txt 파일을 읽습니다.' }])
  })

  it('목록 항목 안에 4칸 넘게 들여 쓴 알림 상자도 상자로 본다', () => {
    const md = ['- 첫 항목입니다.', '', '    > **주의**', '    >', '    > 들여 쓴 주의입니다.', '', '10. 열 번째 항목.', '', '     > **참고**', '     >', '     > 들여 쓴 참고.'].join('\n')
    const facts = summarizeHelpSection(chapter([section('agent', '에이전트 상세', null, md)]), 'agent', noValues, vars)
    expect(facts).toEqual([
      { label: '소개', text: '첫 항목입니다.' },
      { label: '소개 2', text: '열 번째 항목.' },
      { label: '주의', text: '들여 쓴 주의입니다.' },
      { label: '참고', text: '들여 쓴 참고.' },
    ])
  })

  it('helpId 절이 없으면 빈 배열', () => {
    expect(summarizeHelpSection(chapter([section('agent', '에이전트 상세', null, '본문.')]), 'nope', noValues, vars)).toEqual([])
  })
})
