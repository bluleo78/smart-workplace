// 위키 멘션 피커의 USER 후보 행 — 이름 없는 이메일형 사용자는 label·sublabel 이 같아 sublabel 을 뺀다(WP-1880 리뷰 후속).
import { describe, expect, it } from 'vitest'

import { userMentionCandidate } from './useWikiEntitySearch'

describe('userMentionCandidate', () => {
  it('이름이 있으면 label=이름, sublabel=@아이디', () => {
    expect(userMentionCandidate({ userId: 1, name: '김민수', username: 'minsu' })).toEqual({
      mtype: 'USER',
      id: 1,
      label: '김민수',
      sublabel: '@minsu',
    })
  })

  it('이름이 있고 이메일형 아이디면 sublabel 은 @ 없이 아이디', () => {
    expect(userMentionCandidate({ userId: 2, name: '관리자', username: 'admin@work-loop.local' }).sublabel).toBe(
      'admin@work-loop.local',
    )
  })

  it('이름 없는 이메일형 사용자는 같은 글자가 두 번 보이지 않게 sublabel 을 뺀다', () => {
    const c = userMentionCandidate({ userId: 3, name: '', username: 'admin@work-loop.local' })
    expect(c.label).toBe('admin@work-loop.local')
    expect(c.sublabel).toBeUndefined()
  })

  it('이름이 아이디 핸들과 같아도 이름이 있으면 아이디 행을 남긴다', () => {
    expect(userMentionCandidate({ userId: 5, name: '@jay', username: 'jay' }).sublabel).toBe('@jay')
  })

  it('공백만인 이름은 없는 것으로 보고 아이디를 라벨로 쓴다(서버 멘션 라벨과 같은 규칙, WP-1897)', () => {
    const c = userMentionCandidate({ userId: 6, name: '   ', username: 'admin@work-loop.local' })
    expect(c.label).toBe('admin@work-loop.local')
    expect(c.sublabel).toBeUndefined()
  })

  it('이름 없는 일반 아이디는 label=아이디, sublabel=@아이디(서로 달라 둘 다 둔다)', () => {
    const c = userMentionCandidate({ userId: 4, name: '', username: 'jay' })
    expect(c.label).toBe('jay')
    expect(c.sublabel).toBe('@jay')
  })
})
