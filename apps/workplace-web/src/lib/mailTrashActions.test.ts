// WP-1682 휴지통 완전 삭제·비우기 판정·문구 — 단추 활성 여부, 줄 문구, 확인 창 본문, 전이 토스트를 글자 그대로 고정한다.
import { describe, expect, it } from 'vitest'

import type { MailServerFolder, MailTrashEmptyStatus } from '@/types/mailFolder'

import {
  PERMANENT_DELETE_UNSUPPORTED_REASON,
  permanentDeleteConfirmBody,
  permanentDeleteFailureToast,
  permanentDeleteState,
  TRASH_COPY_NOTE,
  TRASH_EMPTY_REASON,
  trashEmptyConfirmBody,
  trashEmptyRowText,
  trashEmptyState,
  trashEmptyTransitionToast,
} from './mailTrashActions'

function folder(over: Partial<MailServerFolder> = {}): MailServerFolder {
  return {
    id: 9, displayName: '휴지통', parentId: null, role: 'TRASH', selectable: true, unreadCount: 0, totalCount: 5,
    syncedSince: null, folderSyncedAt: null, permanentDeleteUnsupported: false, ...over,
  }
}
function status(over: Partial<MailTrashEmptyStatus> = {}): MailTrashEmptyStatus {
  return { state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null, ...over }
}

describe('permanentDeleteState', () => {
  it('UIDPLUS 없음이면 비활성 + 긴 이유, 아니면 활성', () => {
    expect(permanentDeleteState(folder({ permanentDeleteUnsupported: true }))).toEqual({ enabled: false, reason: PERMANENT_DELETE_UNSUPPORTED_REASON })
    expect(permanentDeleteState(folder())).toEqual({ enabled: true, reason: null })
    // 메일함 목록이 아직 없으면(undefined) 서버가 막아 주므로 켜 둔다.
    expect(permanentDeleteState(undefined)).toEqual({ enabled: true, reason: null })
  })
})

describe('trashEmptyState', () => {
  it('미지원이면 비활성 + 긴 이유', () => {
    const s = trashEmptyState(folder({ permanentDeleteUnsupported: true }), undefined, false, null)
    expect(s).toMatchObject({ enabled: false, reason: PERMANENT_DELETE_UNSUPPORTED_REASON, running: false, label: '휴지통 비우기' })
  })
  it('진행 중이면 비활성, 이유 없음, 라벨 비우는 중…', () => {
    const s = trashEmptyState(folder(), status({ state: 'RUNNING' }), false, null)
    expect(s).toEqual({ enabled: false, reason: null, running: true, label: '비우는 중…' })
  })
  it('live count 를 모르는 동안(로딩·오류)은 기존 folder.totalCount 판정 그대로 — null + totalCount 0 + 목록 빔이면 비활성(회귀)', () => {
    const s = trashEmptyState(folder({ totalCount: 0 }), undefined, true, null)
    expect(s).toMatchObject({ enabled: false, reason: TRASH_EMPTY_REASON, running: false })
  })
  // WP-1708: emptiness 판정도 live count 가 먼저 — 다른 클라이언트가 302통을 넣어 로컬 목록이 0 이어도 단추는 켜 둔다(줄 글자 302통과 역설적이지 않게).
  it('live count 가 있으면 빈 휴지통 판정도 live count 가 먼저다 — totalCount 0 + 목록 빔 + live 302 면 활성', () => {
    const s = trashEmptyState(folder({ totalCount: 0 }), undefined, true, 302)
    expect(s).toMatchObject({ enabled: true, reason: null, label: '휴지통 비우기' })
  })
  it('live count 0 + 목록 빔은 진짜 빈 휴지통 — 비활성', () => {
    const s = trashEmptyState(folder({ totalCount: 132 }), undefined, true, 0)
    expect(s).toMatchObject({ enabled: false, reason: TRASH_EMPTY_REASON, running: false })
  })
  it('totalCount 0 이어도 목록에 메일이 있으면 활성', () => {
    expect(trashEmptyState(folder({ totalCount: 0 }), undefined, false, null)).toMatchObject({ enabled: true, reason: null, label: '휴지통 비우기' })
  })
  it('totalCount 를 모르거나 있으면 활성, 끝난 상태(DONE)도 활성', () => {
    expect(trashEmptyState(folder({ totalCount: null }), undefined, true, null).enabled).toBe(true)
    expect(trashEmptyState(folder(), status({ state: 'DONE', total: 3, deleted: 3 }), false, null).enabled).toBe(true)
  })
  it('미지원이 진행 중보다 먼저 판정된다', () => {
    const s = trashEmptyState(folder({ permanentDeleteUnsupported: true }), status({ state: 'RUNNING' }), false, null)
    expect(s.reason).toBe(PERMANENT_DELETE_UNSUPPORTED_REASON)
  })
})

describe('trashEmptyRowText', () => {
  // WP-1708: live count(서버 실시간 수) 를 먼저 쓰고, 없으면 folder.totalCount 폴백, 둘 다 없으면 수 없는 문구.
  it('평소 — live count 가 있으면 그걸 쓰고(폴더 낡은 수 132 말고 302), 없으면 folder.totalCount, 둘 다 없으면 수 없는 문구', () => {
    expect(trashEmptyRowText(folder({ totalCount: 132 }), undefined, 302)).toBe('메일 서버 휴지통 302통')
    expect(trashEmptyRowText(folder({ totalCount: 132 }), undefined, null)).toBe('메일 서버 휴지통 132통')
    expect(trashEmptyRowText(folder({ totalCount: null }), undefined, null)).toBe('메일 서버 휴지통')
    expect(trashEmptyRowText(undefined, undefined, null)).toBe('메일 서버 휴지통')
  })
  it('진행 — live count 와 무관하게 진행 글이 먼저다, total 있음·없음, 실패 0 이면 「· 실패」 생략', () => {
    expect(trashEmptyRowText(folder(), status({ state: 'RUNNING', total: null }), 302)).toBe('휴지통을 비우는 중…')
    expect(trashEmptyRowText(folder(), status({ state: 'RUNNING', total: 100, deleted: 40 }), 302)).toBe('휴지통을 비우는 중… 40/100통')
    expect(trashEmptyRowText(folder(), status({ state: 'RUNNING', total: 100, deleted: 40, failed: 2 }), 302)).toBe('휴지통을 비우는 중… 42/100통 · 실패 2')
  })
  it('끝난 상태는 평소 문구(live 없으면 folder)', () => {
    expect(trashEmptyRowText(folder({ totalCount: 7 }), status({ state: 'DONE', total: 3, deleted: 3 }), null)).toBe('메일 서버 휴지통 7통')
  })
  it('미지원 — live count 보다 먼저 판정된다', () => {
    expect(trashEmptyRowText(folder({ permanentDeleteUnsupported: true }), undefined, 302)).toBe('이 메일 서버는 완전히 삭제를 지원하지 않아요')
  })
})

describe('확인 창 문구', () => {
  it('본문 — 제목 있음, 제목 없음은 "(제목 없음)", 비우기 N 있음/없음 글자 그대로, live 없을 때(로딩·실패) 수 없는 문구 회귀', () => {
    expect(permanentDeleteConfirmBody('11월 견적서')).toBe('"11월 견적서" 메일을 메일 서버에서도 지웁니다. 되돌릴 수 없습니다.')
    expect(permanentDeleteConfirmBody('')).toBe('"(제목 없음)" 메일을 메일 서버에서도 지웁니다. 되돌릴 수 없습니다.')
    expect(permanentDeleteConfirmBody(null)).toBe('"(제목 없음)" 메일을 메일 서버에서도 지웁니다. 되돌릴 수 없습니다.')
    expect(trashEmptyConfirmBody(132)).toBe('메일 서버 휴지통의 메일 132통을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.')
    expect(trashEmptyConfirmBody(null)).toBe('메일 서버 휴지통의 메일을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.')
  })
  it('영향 안내', () => {
    expect(TRASH_COPY_NOTE).toBe('드라이브·이슈로 가져간 첨부 사본은 그대로 남습니다.')
  })
})

describe('permanentDeleteFailureToast', () => {
  it('오류 문구가 있으면 덧붙이고, 없거나 비면 문구만', () => {
    expect(permanentDeleteFailureToast('메일함이 바뀌었습니다')).toBe('완전히 삭제하지 못했습니다 — 메일함이 바뀌었습니다')
    expect(permanentDeleteFailureToast(null)).toBe('완전히 삭제하지 못했습니다')
    expect(permanentDeleteFailureToast('')).toBe('완전히 삭제하지 못했습니다')
  })
})

describe('trashEmptyTransitionToast', () => {
  const running = status({ state: 'RUNNING', total: 10, deleted: 4 })
  it('prev 가 없거나 RUNNING 이 아니면 null — 휴지통을 열 때 이미 끝난 상태로는 알리지 않는다', () => {
    expect(trashEmptyTransitionToast(undefined, status({ state: 'DONE', total: 3, deleted: 3 }))).toBeNull()
    expect(trashEmptyTransitionToast(status({ state: 'DONE' }), status({ state: 'DONE' }))).toBeNull()
    expect(trashEmptyTransitionToast(status({ state: 'IDLE' }), status({ state: 'FAILED', error: 'x' }))).toBeNull()
  })
  it('RUNNING → RUNNING 은 null', () => {
    expect(trashEmptyTransitionToast(running, status({ state: 'RUNNING', total: 10, deleted: 5 }))).toBeNull()
  })
  it('RUNNING → DONE 실패 0 — 성공', () => {
    expect(trashEmptyTransitionToast(running, status({ state: 'DONE', total: 10, deleted: 10 }))).toEqual({ kind: 'success', message: '휴지통을 비웠습니다 (10통)' })
  })
  it('RUNNING → DONE 실패 있음 — 경고', () => {
    expect(trashEmptyTransitionToast(running, status({ state: 'DONE', total: 10, deleted: 8, failed: 2 }))).toEqual({
      kind: 'warning', message: '8통을 지우고 2통은 지우지 못했습니다. 다시 비워 주세요.',
    })
  })
  it('RUNNING → FAILED — 오류, error 없으면 문구만', () => {
    expect(trashEmptyTransitionToast(running, status({ state: 'FAILED', error: '메일 서버에 연결하지 못했습니다' }))).toEqual({
      kind: 'error', message: '휴지통을 비우지 못했습니다 — 메일 서버에 연결하지 못했습니다',
    })
    expect(trashEmptyTransitionToast(running, status({ state: 'FAILED' }))).toEqual({ kind: 'error', message: '휴지통을 비우지 못했습니다' })
  })
  it('RUNNING → IDLE — 중단 경고', () => {
    expect(trashEmptyTransitionToast(running, status({ state: 'IDLE' }))).toEqual({
      kind: 'warning', message: '휴지통 비우기가 중단됐습니다. 남은 메일이 있으면 다시 비워 주세요.',
    })
  })
})
