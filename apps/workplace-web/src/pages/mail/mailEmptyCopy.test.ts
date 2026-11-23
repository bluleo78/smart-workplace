// 메일 목록 빈 상태 문구(mailListEmptyCopy) 단위 테스트(WP-1864 리뷰 후속).
// 「새로고침 단추를 눌러보세요.」의 반대 갈래(단추가 없는 보기는 단추를 가리키지 않는다)는
// 렌더로 닿지 않아(mail-box-empty·mail-flagged-empty·mail-drafts-empty 가 먼저 그림) 여기서 고정한다.
import { describe, expect, test } from 'vitest'

import { mailListEmptyCopy } from './mailEmptyCopy'

const inbox = { search: '', folderParam: 'INBOX', showSyncControls: true, viewTitle: '받은편지함' } as const

describe('mailListEmptyCopy', () => {
  test('검색 0건은 검색 안내를 쓴다 — 단추 문구와 받은편지함 제목을 함께 쓰지 않는다', () => {
    expect(mailListEmptyCopy({ ...inbox, search: '없는검색어' })).toEqual({
      title: '검색 결과가 없어요',
      description: '다른 검색어로 찾아보세요.',
    })
  })

  test('보낸편지함은 자기 제목·설명을 쓴다(WP-1864 리뷰 후속 — 단추 없는 보기)', () => {
    expect(mailListEmptyCopy({ ...inbox, folderParam: 'SENT', showSyncControls: false, viewTitle: '보낸편지함' })).toEqual({
      title: '보낸 메일이 없어요',
      description: '메일을 보내면 여기에 모여요.',
    })
  })

  test('동기화 단추가 있는 받은편지함은 단추를 가리킨다', () => {
    expect(mailListEmptyCopy(inbox)).toEqual({
      title: '받은 메일이 없어요',
      description: '새로고침 단추를 눌러보세요.',
    })
  })

  test('단추 없는 보기에 검색을 건 조합도 검색 문구가 먼저다(우선순위 확인)', () => {
    expect(mailListEmptyCopy({ ...inbox, showSyncControls: false, search: '없는검색어' })).toEqual({
      title: '검색 결과가 없어요',
      description: '다른 검색어로 찾아보세요.',
    })
  })

  // 아래 보기 이름들은 지금 렌더에서 오지 않는 조합이다(서버 메일함은 mail-box-empty, 별표 모아 보기는 검색하지
  // 않을 때 mail-flagged-empty 가 먼저 그린다) — 템플릿의 일반성(제목을 보기에 맞춘다)을 단위로 지킨다.
  test('단추가 없는 보기는 단추를 가리키지 않고 제목도 그 보기에 맞춘다(WP-1864 재반려 1·리뷰 후속 ②)', () => {
    expect(mailListEmptyCopy({ ...inbox, showSyncControls: false, viewTitle: '보관' })).toEqual({
      title: '보관 메일이 없어요',
      description: '이 보기에 보여 줄 메일이 없어요.',
    })
    expect(mailListEmptyCopy({ ...inbox, showSyncControls: false, viewTitle: '휴지통' })).toEqual({
      title: '휴지통 메일이 없어요',
      description: '이 보기에 보여 줄 메일이 없어요.',
    })
    expect(mailListEmptyCopy({ ...inbox, showSyncControls: false, viewTitle: '별표' })).toEqual({
      title: '별표 메일이 없어요',
      description: '이 보기에 보여 줄 메일이 없어요.',
    })
  })
})
