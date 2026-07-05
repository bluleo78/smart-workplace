import { describe, expect, it } from 'vitest'
import { buildReverseGraph, computeAffectedDomains } from './affected-domains.mjs'

describe('buildReverseGraph', () => {
  it('전방 그래프를 역인접 맵으로 뒤집는다', () => {
    const graph = {
      'components/ui/button.tsx': [],
      'pages/mail/MailInboxPage.tsx': ['components/ui/button.tsx'],
      'pages/drive/DrivePage.tsx': ['components/ui/button.tsx'],
    }
    const reverse = buildReverseGraph(graph)
    expect(reverse.get('components/ui/button.tsx')).toEqual(
      new Set(['pages/mail/MailInboxPage.tsx', 'pages/drive/DrivePage.tsx']),
    )
  })
})

describe('computeAffectedDomains', () => {
  const domains = ['mail', 'drive', 'calendar']

  it('단일 도메인 페이지에서만 참조되는 파일 → 그 도메인만 반환', () => {
    const graphObj = {
      'lib/format.ts': [],
      'pages/mail/MailInboxPage.tsx': ['lib/format.ts'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['lib/format.ts'], { graphObj, reverseGraph, domains })
    expect(result).toEqual(['mail'])
  })

  it('여러 도메인 페이지에서 참조되는 파일 → 도메인 집합(정렬/중복제거) 반환', () => {
    const graphObj = {
      'components/ui/button.tsx': [],
      'pages/mail/MailInboxPage.tsx': ['components/ui/button.tsx'],
      'pages/drive/DrivePage.tsx': ['components/ui/button.tsx'],
      'pages/drive/DriveSpacePage.tsx': ['components/ui/button.tsx'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['components/ui/button.tsx'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual(['drive', 'mail'])
  })

  it('간접(2단계 이상) 참조도 추적한다', () => {
    const graphObj = {
      'lib/date.ts': [],
      'components/calendar/EventCard.tsx': ['lib/date.ts'],
      'pages/calendar/CalendarPage.tsx': ['components/calendar/EventCard.tsx'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['lib/date.ts'], { graphObj, reverseGraph, domains })
    expect(result).toEqual(['calendar'])
  })

  it('톱레벨 flat 페이지(도메인 서브디렉토리 아님)에서 참조되면 ALL', () => {
    const graphObj = {
      'components/layout/PageHeader.tsx': [],
      'pages/HomePage.tsx': ['components/layout/PageHeader.tsx'],
      'pages/mail/MailInboxPage.tsx': ['components/layout/PageHeader.tsx'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['components/layout/PageHeader.tsx'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual(['ALL'])
  })

  it('그래프에 없는(신규/미인식) 파일은 ALL로 안전하게 fallback', () => {
    const graphObj = { 'pages/mail/MailInboxPage.tsx': [] }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['lib/brand-new-file.ts'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual(['ALL'])
  })

  it('어떤 페이지에도 도달하지 않는 파일은 빈 배열(불필요한 E2E 없음)', () => {
    const graphObj = {
      'lib/deadCodeOnly.ts': [],
      'lib/otherUnusedHelper.ts': ['lib/deadCodeOnly.ts'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['lib/deadCodeOnly.ts'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual([])
  })

  it('변경 파일이 여러 개면 도메인을 합집합한다', () => {
    const graphObj = {
      'lib/format.ts': [],
      'lib/date.ts': [],
      'pages/mail/MailInboxPage.tsx': ['lib/format.ts'],
      'pages/calendar/CalendarPage.tsx': ['lib/date.ts'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['lib/format.ts', 'lib/date.ts'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual(['calendar', 'mail'])
  })

  it('라우터 Outlet 레이아웃처럼 pages/** 없이 그래프 루트(main.tsx)까지 도달하면 ALL', () => {
    const graphObj = {
      'components/mail/MailComposer.tsx': [],
      'components/mail/MailComposeDock.tsx': ['components/mail/MailComposer.tsx'],
      'components/layout/AppLayout.tsx': ['components/mail/MailComposeDock.tsx'],
      'App.tsx': ['components/layout/AppLayout.tsx'],
      'main.tsx': ['App.tsx'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['components/mail/MailComposer.tsx'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual(['ALL'])
  })

  it('한 파일이라도 ALL이면 전체 결과가 ALL', () => {
    const graphObj = {
      'lib/format.ts': [],
      'pages/mail/MailInboxPage.tsx': ['lib/format.ts'],
    }
    const reverseGraph = buildReverseGraph(graphObj)
    const result = computeAffectedDomains(['lib/format.ts', 'lib/never-seen.ts'], {
      graphObj,
      reverseGraph,
      domains,
    })
    expect(result).toEqual(['ALL'])
  })
})
