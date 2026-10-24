// 알림 설정 화면 문구·칸 표시 규칙(WP-913) — 문구는 합의 시안 v2 그대로, 칸은 앱 스위치가 꺼지면 꺼진 채 잠긴다.
import { describe, expect, it } from 'vitest'

import type { NotificationAppSetting } from '@/types/notificationSettings'

import { APP_LABEL, APP_NOTE, cellView, ITEM_META, knownApps } from './notificationSettingsMeta'

describe('APP_NOTE', () => {
  it('채팅에만 푸시로만 알린다는 안내가 있다', () => {
    expect(APP_NOTE).toEqual({ CHAT: '채팅은 알림 목록에 쌓이지 않고 푸시로만 알려요. 꺼도 메시지와 안 읽음 표시는 채팅에 그대로 있어요.' })
  })
})

describe('ITEM_META', () => {
  it('시안 v2 문구를 그대로 쓴다', () => {
    expect(ITEM_META.ISSUE_ASSIGNED).toEqual({ label: '나에게 할당', description: '누군가 나를 담당자로 지정' })
    expect(ITEM_META.ISSUE_COMMENTED).toEqual({ label: '코멘트', description: '내가 담당·지켜보는 이슈' })
    expect(ITEM_META.ISSUE_STATUS_CHANGED).toEqual({ label: '상태 변경', description: '완료 포함 · 내가 담당·지켜보는 이슈' })
    expect(ITEM_META.ISSUE_PRIORITY_CHANGED).toEqual({ label: '우선순위 변경' })
    expect(ITEM_META.ISSUE_MENTIONED).toEqual({ label: '나를 멘션' })
    expect(ITEM_META.ISSUE_AI_NEEDS_INPUT).toEqual({ label: '답변 필요', description: '질문 · 권한 필요 · 막힘', ai: true })
    expect(ITEM_META.ISSUE_AI_REVIEW_REQUESTED).toEqual({ label: '검토 요청', description: '내가 맡긴 작업이 검토 대기', ai: true })
    expect(ITEM_META.ISSUE_AI_FAILED).toEqual({ label: '실패', description: '내가 맡긴 작업 실패·거절', ai: true })
    expect(ITEM_META.CHAT_DM).toEqual({ label: 'DM' })
    expect(ITEM_META.CHAT_CHANNEL_MENTION).toEqual({ label: '채널에서 나를 멘션' })
    expect(ITEM_META.CALENDAR_INVITED).toEqual({ label: '초대' })
    expect(ITEM_META.CALENDAR_EVENT_UPDATED).toEqual({ label: '일정 변경' })
    expect(ITEM_META.CALENDAR_EVENT_CANCELED).toEqual({ label: '일정 취소' })
    expect(ITEM_META.CALENDAR_RSVP_CHANGED).toEqual({ label: '참석 응답' })
    expect(ITEM_META.CALENDAR_REMINDER).toEqual({ label: '리마인더', description: '시간이 되면 알림' })
    expect(ITEM_META.WIKI_SHARED).toEqual({ label: '공유받음' })
    expect(ITEM_META.WIKI_ACCESS_REQUESTED).toEqual({ label: '접근 요청' })
    expect(ITEM_META.WIKI_ACCESS_APPROVED).toEqual({ label: '접근 승인' })
  })

  it('18개 항목을 모두 가진다', () => {
    expect(Object.keys(ITEM_META)).toHaveLength(18)
  })

  it('앱 이름', () => {
    expect(APP_LABEL).toEqual({ ISSUE: '이슈', CHAT: '채팅', CALENDAR: '캘린더', WIKI: '노트' })
  })
})

describe('cellView', () => {
  it('칸이 없으면(null) 그리지 않는다', () => {
    expect(cellView(true, null).present).toBe(false)
    expect(cellView(false, null).present).toBe(false)
  })

  it('앱이 켜져 있으면 저장값 그대로, 잠기지 않는다', () => {
    expect(cellView(true, false)).toEqual({ present: true, checked: false, locked: false })
    expect(cellView(true, true)).toEqual({ present: true, checked: true, locked: false })
  })

  it('앱이 꺼지면 값과 상관없이 꺼진 것처럼 보이고 잠긴다', () => {
    expect(cellView(false, true)).toEqual({ present: true, checked: false, locked: true })
    expect(cellView(false, false)).toEqual({ present: true, checked: false, locked: true })
  })
})

describe('knownApps', () => {
  it('화면이 모르는 앱 카드와 항목 줄은 건너뛴다(새 서버가 먼저 배포된 경우)', () => {
    const apps = [
      {
        app: 'ISSUE',
        enabled: true,
        items: [
          { item: 'ISSUE_ASSIGNED', human: true, agent: true },
          { item: 'ISSUE_FUTURE_ITEM', human: true, agent: null },
        ],
      },
      { app: 'DRIVE', enabled: false, items: [{ item: 'DRIVE_SHARED', human: true, agent: true }] },
    ] as unknown as NotificationAppSetting[]
    const out = knownApps(apps)
    expect(out.map((a) => a.app)).toEqual(['ISSUE'])
    expect(out[0].items.map((it) => it.item)).toEqual(['ISSUE_ASSIGNED'])
  })
})
