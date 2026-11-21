// WP-1682 휴지통 메일 「완전히 삭제」·「휴지통 비우기」 — 단추 활성 판정과 화면 문구를 순수 함수로 둔다.
// 화면(MailTrashActions·상세 작업 줄·모바일 메뉴)은 이 파일의 결과만 그려, 두 곳이 같은 이유·같은 글자를 보이고 vitest 로 고정된다.
// 문구는 spec(docs/superpowers/specs/2026-11-17-mail-trash-permanent-delete-design.md)의 「문구」 표 글자 그대로다.
import type { MailServerFolder, MailTrashEmptyStatus } from '@/types/mailFolder'

import { mailSubjectText } from './mailSubject'

/** 비활성 이유 툴팁(두 단추) — IMAP 서버가 UIDPLUS(메일을 골라 지우는 기능)를 지원하지 않는다. */
export const PERMANENT_DELETE_UNSUPPORTED_REASON =
  '이 메일 서버는 메일을 골라 지우는 기능(UIDPLUS)이 없어 완전히 삭제할 수 없어요. 메일 서버의 웹메일에서 지워 주세요.'
/** 모바일 「⋯」 메뉴 항목 아래 작은 글 — 터치에는 툴팁이 없어 짧게 글로 보인다. */
export const PERMANENT_DELETE_UNSUPPORTED_SHORT = '이 메일 서버는 지원하지 않아요'
/** 빈 휴지통에서 「휴지통 비우기」가 꺼진 이유. */
export const TRASH_EMPTY_REASON = '휴지통이 비어 있어요'
/** 비우기가 진행 중일 때 감싸개(툴팁·이름)에 쓰는 이유 — 단추 라벨은 「비우는 중…」이지만 왜 못 누르는지는 이름으로 알린다(WP-1856). */
export const TRASH_EMPTY_RUNNING_REASON = '휴지통을 비우는 중이에요'
/** 한 통 완전 삭제 요청이 처리 중일 때 감싸개에 쓰는 이유(WP-1856). */
export const PERMANENT_DELETE_PENDING_REASON = '삭제하는 중이에요'
/** 확인 창 영향 안내(두 확인 창 공통) — 드라이브·이슈로 가져간 첨부는 새 파일이라 메일을 지워도 남는다. */
export const TRASH_COPY_NOTE = '드라이브·이슈로 가져간 첨부 사본은 그대로 남습니다.'

/** 단추 하나의 활성 여부와 비활성 이유(툴팁) — reason 이 null 이면 이유를 보이지 않는다. */
export interface TrashButtonState {
  enabled: boolean
  reason: string | null
}

/**
 * 처리 요청 중(pending)이면 이유 없는 켜짐 상태를 「처리 중 이유」로 막는다 — 상태가 이미 가진 이유(미지원 등)가 먼저다.
 * 모든 막힘이 이유를 가지므로 호출부는 reason 하나로 감싸개·이름·disabled 를 정한다(WP-1852·1856).
 */
export function foldPendingReason(state: TrashButtonState, pending: boolean, pendingReason: string): TrashButtonState {
  return pending && state.reason == null ? { enabled: false, reason: pendingReason } : state
}

/**
 * 상세 「완전히 삭제」 단추 — UIDPLUS 없음으로 기록된 서버면 비활성 + 이유.
 * 휴지통 행을 모르거나(undefined) 모름(null 기록)이면 켜 둔다 — 실행이 서버에서 확인해 막는다(PERMANENT_DELETE_UNSUPPORTED).
 */
export function permanentDeleteState(folder: MailServerFolder | undefined, pending = false): TrashButtonState {
  const base: TrashButtonState = folder?.permanentDeleteUnsupported
    ? { enabled: false, reason: PERMANENT_DELETE_UNSUPPORTED_REASON }
    : { enabled: true, reason: null }
  return foldPendingReason(base, pending, PERMANENT_DELETE_PENDING_REASON)
}

/**
 * 목록 위 「휴지통 비우기」 단추 — 미지원 → 진행 중 → 빈 휴지통 순으로 판정한다.
 * 빈 휴지통은 전체 수가 0 이고 보이는 목록도 비었을 때만이다. 전체 수는 liveCount(서버 실시간 수) 가 먼저고 모르는 동안(로딩·오류)은
 * folder.totalCount(마지막 목록 갱신 값) 로 판정한다 — 줄 글자(trashEmptyRowText) 와 같은 폴백 패턴이라, live 302통인데 로컬 목록만
 * 비어 있으면 줄은 「302통」인데 단추만 「비어 있어요」로 잠기지 않게 한다(새 정보를 모를 땐 기존 동작 유지).
 * 진행 중은 이유(TRASH_EMPTY_RUNNING_REASON)와 함께 비활성이고 라벨은 「비우는 중…」으로 바뀐다.
 */
export function trashEmptyState(
  folder: MailServerFolder | undefined,
  status: MailTrashEmptyStatus | undefined,
  listEmpty: boolean,
  liveCount: number | null,
  pending = false,
): TrashButtonState & { running: boolean; label: '휴지통 비우기' | '비우는 중…' } {
  if (folder?.permanentDeleteUnsupported) {
    return { enabled: false, reason: PERMANENT_DELETE_UNSUPPORTED_REASON, running: false, label: '휴지통 비우기' }
  }
  if (status?.state === 'RUNNING') {
    return { enabled: false, reason: TRASH_EMPTY_RUNNING_REASON, running: true, label: '비우는 중…' }
  }
  // live count 를 먼저 쓴다 — folder.totalCount 는 마지막 목록 동기화 값이라 실제와 어긋날 수 있다(수는 낡았을 수 있어 목록에 메일이 보이면 켠다).
  const total = liveCount ?? folder?.totalCount
  if (total === 0 && listEmpty) {
    return { enabled: false, reason: TRASH_EMPTY_REASON, running: false, label: '휴지통 비우기' }
  }
  // 시작 요청 중이면 이유와 함께 막는다(WP-1856) — 진행(RUNNING)은 아니라 라벨은 그대로.
  const idle = foldPendingReason({ enabled: true, reason: null }, pending, TRASH_EMPTY_RUNNING_REASON)
  return { ...idle, running: false, label: '휴지통 비우기' }
}

/**
 * 비우기 줄 왼쪽 글 — 미지원 → 진행(`처리/전체통 · 실패 n`) → 평소(서버 휴지통 수) 순.
 * 평소 수는 liveCount(서버 실시간 수) 가 먼저고 없으면 folder.totalCount 로 폴백하며, 둘 다 없으면 수를 쓰지 않는다.
 * 진행·미지원 판정은 liveCount 보다 먼저다 — 서버 수와 무관하게 지금 화면이 말해야 할 상태다.
 */
export function trashEmptyRowText(
  folder: MailServerFolder | undefined,
  status: MailTrashEmptyStatus | undefined,
  liveCount: number | null,
): string {
  if (folder?.permanentDeleteUnsupported) return '이 메일 서버는 완전히 삭제를 지원하지 않아요'
  if (status?.state === 'RUNNING') {
    if (status.total == null) return '휴지통을 비우는 중…'
    const failed = status.failed > 0 ? ` · 실패 ${status.failed}` : ''
    return `휴지통을 비우는 중… ${status.deleted + status.failed}/${status.total}통${failed}`
  }
  // live count 를 먼저 쓴다 — folder.totalCount 는 마지막 목록 동기화 값이라 실제와 어긋날 수 있다.
  // 줄은 수 없는 글자("메일 서버 휴지통")가 어색해 폴더 값으로 폴백한다(확인 창은 폴백 없음 — trashEmptyConfirmBody 참고).
  const total = liveCount ?? folder?.totalCount
  return total != null ? `메일 서버 휴지통 ${total}통` : '메일 서버 휴지통'
}

/** 한 통 완전 삭제 확인 창 본문 — 제목이 비면 「(제목 없음)」. */
export function permanentDeleteConfirmBody(subject: string | null | undefined): string {
  return `"${mailSubjectText(subject)}" 메일을 메일 서버에서도 지웁니다. 되돌릴 수 없습니다.`
}

/**
 * 휴지통 비우기 확인 창 본문 — 서버 휴지통 전체(앱에 보이지 않는 30일 지난 메일 포함)를 지운다는 사실을 적는다.
 * total 은 서버 실시간 수(WP-1708). 없으면(null — 로딩·조회 실패) 수를 아예 쓰지 않는다 — 낡은 수를 보여 주지 않기 위함으로,
 * 줄 글자와 달리 folder.totalCount 로는 폴백하지 않는다.
 */
export function trashEmptyConfirmBody(total: number | null): string {
  const target = total != null ? `메일 서버 휴지통의 메일 ${total}통을` : '메일 서버 휴지통의 메일을'
  return `${target} 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.`
}

/** 한 통 완전 삭제 실패 토스트 — 서버가 준 문구(메일별 오류 또는 요청 오류 message)가 있으면 덧붙이고 없거나 비면 문구만. */
export function permanentDeleteFailureToast(error: string | null): string {
  return error ? `완전히 삭제하지 못했습니다 — ${error}` : '완전히 삭제하지 못했습니다'
}

/** 비우기가 끝났을 때 띄울 토스트 — kind 로 success·warning·error 를 고른다. */
export interface TrashEmptyToast {
  kind: 'success' | 'warning' | 'error'
  message: string
}

/**
 * 상태가 바뀐 순간의 토스트 — 진행(RUNNING)을 보고 있다가 끝났을 때만 알린다.
 * prev 가 RUNNING 이 아니면(처음 받은 값·이미 끝난 상태로 휴지통을 연 경우) null 이다 — 지난 작업 결과를 다시 알리지 않는다.
 * RUNNING → IDLE 은 서버 재시작 등으로 작업이 사라진 것이라 「중단됨」으로 알린다.
 */
export function trashEmptyTransitionToast(prev: MailTrashEmptyStatus | undefined, next: MailTrashEmptyStatus): TrashEmptyToast | null {
  if (prev?.state !== 'RUNNING') return null
  return endStateToast(next)
}

/**
 * 끝난 상태(DONE·FAILED·IDLE)에 대한 토스트 — RUNNING 이면 null.
 * 시작 요청의 응답이 이미 DONE·FAILED 인 경우(스냅샷 전에 끝난 작업)에도 같은 문구를 쓰려고 따로 뺐다.
 */
export function endStateToast(next: MailTrashEmptyStatus): TrashEmptyToast | null {
  switch (next.state) {
    case 'DONE':
      return next.failed > 0
        ? { kind: 'warning', message: `${next.deleted}통을 지우고 ${next.failed}통은 지우지 못했습니다. 다시 비워 주세요.` }
        : { kind: 'success', message: `휴지통을 비웠습니다 (${next.deleted}통)` }
    case 'FAILED':
      return { kind: 'error', message: next.error ? `휴지통을 비우지 못했습니다 — ${next.error}` : '휴지통을 비우지 못했습니다' }
    case 'IDLE':
      return { kind: 'warning', message: '휴지통 비우기가 중단됐습니다. 남은 메일이 있으면 다시 비워 주세요.' }
    default:
      return null
  }
}
