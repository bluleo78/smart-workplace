// 탭 제목 규칙(WP-814) — 조각 잇기와 주소별 기본 화면 이름.
import { describe, expect, it } from 'vitest'

import { APP_TITLE, formatDocumentTitle, routeTitleParts } from './documentTitle'

describe('formatDocumentTitle', () => {
  it('조각을 「 · 」로 잇고 앱 이름을 끝에 붙인다', () => {
    expect(formatDocumentTitle(['# 개발팀', '대화'])).toBe('# 개발팀 · 대화 · Gen:iA Works')
  })

  it('비었거나 공백뿐인 조각·거짓 값은 건너뛴다', () => {
    expect(formatDocumentTitle([null, '  ', undefined, false, '노트'])).toBe('노트 · Gen:iA Works')
  })

  it('조각이 없으면 앱 이름만', () => {
    expect(formatDocumentTitle([])).toBe(APP_TITLE)
  })
})

describe('routeTitleParts', () => {
  it.each([
    ['/', ['홈']],
    ['/chat', ['대화']],
    ['/chat/channels/3', ['대화']],
    ['/chat/new', ['새 메시지', '대화']],
    ['/chat/threads/inbox', ['스레드', '대화']],
    ['/mail/1', ['메일']],
    ['/calendar', ['캘린더']],
    ['/projects/WP/issues/3', ['작업 관리']],
    ['/me/tasks/assigned', ['내 작업']],
    ['/me/ai-tasks', ['AI 위임 작업']],
    ['/drive/spaces/2', ['드라이브']],
    ['/drive/attachments', ['첨부 모아보기', '드라이브']],
    ['/wiki/spaces/1/pages/9', ['노트']],
    ['/contacts', ['연락처']],
    ['/settings/profile', ['프로필', '설정']],
    ['/settings/users/4', ['구성원', '설정']],
    ['/settings', ['설정']],
    ['/login', ['로그인']],
  ])('%s → %j', (path, parts) => {
    expect(routeTitleParts(path)).toEqual(parts)
  })

  it('모르는 주소는 빈 조각(앱 이름만)', () => {
    expect(routeTitleParts('/s/abc')).toEqual([])
  })
})
