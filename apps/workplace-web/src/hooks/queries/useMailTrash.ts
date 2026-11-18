// WP-1682 휴지통 메일 「완전히 삭제」·「휴지통 비우기」 훅 — 완전 삭제 mutation, 비우기 시작 mutation, 비우기 진행 상태 query.
// 판정·문구는 lib/mailTrashActions 의 순수 함수가 맡고, 이 파일은 서버 호출·캐시 무효화·토스트만 한다.
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { getMailTrashCount, getTrashEmptyStatus, permanentDeleteMessages, startTrashEmpty } from '@/api/mailMessages'
import { apiErrorResponse, extractApiError, extractApiErrorCode } from '@/lib/api-error'
import { flushMailMoves } from '@/lib/mailMoveQueue'
import {
  endStateToast,
  permanentDeleteFailureToast,
  type TrashEmptyToast,
  trashEmptyTransitionToast,
} from '@/lib/mailTrashActions'
import type { MailTrashEmptyStatus } from '@/types/mailFolder'

import { mailMessageKeys } from './mailMessageKeys'
import { invalidateMailCounts } from './useMailMessages'

/** 서버가 UIDPLUS 없음으로 막았을 때의 오류 코드 — 메일함 목록을 다시 받으면 두 단추가 비활성으로 바뀐다. */
const UNSUPPORTED_CODE = 'PERMANENT_DELETE_UNSUPPORTED'

/** 토스트 종류별로 sonner 를 부른다. */
function showToast({ kind, message }: TrashEmptyToast): void {
  toast[kind](message)
}

/**
 * 메일이 지워진 뒤(완전 삭제·비우기 끝) 메일 목록·안 읽은 수·홈 요약·메일함 목록(휴지통 수)·실시간 휴지통 수를 다시 받는다 — 옮기기와 같은 무효화.
 * 안 읽은 수 키 아래에 메일함 목록도 있다(mailMessageKeys.folders) — 휴지통 전체 수가 맞춰진다.
 * 실시간 수(mailMessageKeys.trashCount)는 비운 뒤 확인 창·줄이 낡은 수를 계속 보여 주지 않게 따로 무효화한다(목록 캐시와 분리된 접두사).
 */
function invalidateAfterErase(qc: QueryClient, accountId: number): void {
  void qc.invalidateQueries({ queryKey: ['mail-messages', accountId] })
  void qc.invalidateQueries({ queryKey: mailMessageKeys.trashCount(accountId) })
  invalidateMailCounts(qc)
}

/** 서버가 UIDPLUS 없음으로 막았으면(PERMANENT_DELETE_UNSUPPORTED) 메일함 목록을 다시 받아 두 단추를 비활성으로 바꾼다. 토스트는 부르는 쪽이 띄운다. */
function refetchFoldersIfUnsupported(qc: QueryClient, accountId: number | undefined, e: unknown): void {
  if (extractApiErrorCode(e) === UNSUPPORTED_CODE && accountId) {
    void qc.invalidateQueries({ queryKey: mailMessageKeys.folders(accountId) })
  }
}

/**
 * WP-1708 휴지통 메일 수(서버 실시간) — 확인 창 본문·비우기 줄 글자가 마지막 목록 동기화 값(folder.totalCount)이 아닌 서버 실제 수를 쓰게 한다.
 * 실패(400·502)는 재시도하지 않고 오류로 남긴다 — 호출 측이 확인 창은 수 없는 문구로, 줄은 folder.totalCount 폴백으로 그려
 * 낡은 숫자를 절대 보여 주지 않게 하기 위함이다.
 */
export function useTrashCount(accountId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: mailMessageKeys.trashCount(accountId ?? 0),
    queryFn: () => getMailTrashCount(accountId as number),
    enabled: !!accountId && enabled,
    // 실패 재시도 없음 — 재시도는 확인 창 본문의 수 없는 문구만 늦추고 성공 가능성을 바꾸지 못한다(오류는 서버가 확정한 상태).
    retry: false,
  })
}

/**
 * 휴지통 비우기 진행 상태 — RUNNING 동안 1초 간격으로 다시 묻고, 그 밖에는 멈춘다.
 * RUNNING → 끝남(DONE·FAILED·IDLE) 전이를 여기서 한 번 알린다(토스트 + 목록 무효화) — 한 화면에서 한 곳(비우기 줄)만 부른다.
 * 이미 끝난 상태로 휴지통을 열었을 때는 알리지 않는다(trashEmptyTransitionToast 가 prev 가 RUNNING 일 때만 값을 준다).
 */
export function useTrashEmptyStatus(accountId: number | undefined, enabled: boolean) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: mailMessageKeys.trashEmpty(accountId ?? 0),
    queryFn: () => getTrashEmptyStatus(accountId as number),
    enabled: !!accountId && enabled,
    refetchInterval: (q) => (q.state.data?.state === 'RUNNING' ? 1000 : false),
  })

  // 직전에 본 상태 — 계정이 바뀌면 비운다(다른 계정의 상태와 전이로 엮이지 않게). 선언 순서상 아래 효과보다 먼저 돈다.
  const prev = useRef<MailTrashEmptyStatus | undefined>(undefined)
  useEffect(() => {
    prev.current = undefined
  }, [accountId])

  const data = query.data
  useEffect(() => {
    if (!data || !accountId) return
    const was = prev.current
    prev.current = data
    const t = trashEmptyTransitionToast(was, data)
    if (t) showToast(t)
    if (was?.state === 'RUNNING' && data.state !== 'RUNNING') invalidateAfterErase(qc, accountId)
  }, [data, accountId, qc])

  return query
}

/**
 * 「휴지통 비우기」 시작 — 먼저 그 계정의 대기 중 옮기기(실행 취소 토스트 중인 되살리기 등)를 서버에 보내 끝내고,
 * 그다음 비우기를 시작해 돌아온 상태를 상태 query 에 넣는다(RUNNING 이면 폴링이 바로 시작된다).
 * 시작 응답이 이미 DONE·FAILED 면(스냅샷을 뜨기 전에 끝난 작업) 상태 query 가 RUNNING 을 본 적이 없어 전이 토스트가 나지 않으므로 여기서 알린다.
 */
export function useStartTrashEmpty(accountId: number | undefined) {
  const qc = useQueryClient()
  return useMutation<MailTrashEmptyStatus, unknown, void>({
    mutationFn: async () => {
      const id = accountId as number
      await flushMailMoves(id)
      const next = await startTrashEmpty(id)
      const key = mailMessageKeys.trashEmpty(id)
      const was = qc.getQueryData<MailTrashEmptyStatus>(key)
      qc.setQueryData(key, next)
      // 상태 query 가 이미 RUNNING 을 봤다면 그쪽 전이 효과가 알린다 — 두 번 알리지 않는다.
      if ((next.state === 'DONE' || next.state === 'FAILED') && was?.state !== 'RUNNING') {
        const t = endStateToast(next)
        if (t) showToast(t)
        invalidateAfterErase(qc, id)
      }
      return next
    },
    onError: (e) => {
      refetchFoldersIfUnsupported(qc, accountId, e)
      toast.error(extractApiError(e, '휴지통을 비우지 못했습니다'))
    },
  })
}

/**
 * 휴지통 메일 한 통 완전히 삭제 — 성공(ok)이면 true 를 돌려주고 onDeleted(id)(상세 닫기), 메일 목록·안 읽은 수·홈 요약·메일함 목록을 무효화하고 상세는 낡음 표시만 한다.
 * ok=false(메일 서버가 그 메일을 못 지움)면 false — 상세는 그대로 두고 메일별 오류를 알린다. 요청 오류는 서버 message 를 덧붙인다.
 * 서버가 UIDPLUS 없음으로 막았다면(PERMANENT_DELETE_UNSUPPORTED) 메일함 목록을 다시 받아 단추를 비활성으로 바꾼다.
 */
export function usePermanentDeleteMail(accountId: number | undefined, opts: { onDeleted: (id: number) => void }) {
  const qc = useQueryClient()
  return useMutation<boolean, unknown, number>({
    mutationFn: async (messageId) => {
      const id = accountId as number
      const res = await permanentDeleteMessages(id, [messageId])
      // 결과에 빠졌으면(있어선 안 되지만) 실패로 본다 — 지워지지 않은 메일의 상세를 닫지 않게.
      const result = res.results.find((r) => r.messageId === messageId)
      if (!result?.ok) {
        toast.error(permanentDeleteFailureToast(result?.error ?? null))
        return false
      }
      toast.success('완전히 삭제했습니다')
      opts.onDeleted(messageId)
      invalidateAfterErase(qc, id)
      // 상세는 다시 받지 않고 낡음 표시만 한다 — 상세 닫기(onDeleted)가 주소 이동이라 아직 열려 있는 이 순간에 다시 받으면
      // 지워진 메일이 404 로 「메일을 불러오지 못했습니다」를 잠깐 보인다. 뒤로 가기로 다시 열면 그때 받아 없음을 알린다.
      void qc.invalidateQueries({ queryKey: mailMessageKeys.detail(messageId), refetchType: 'none' })
      return true
    },
    onError: (e) => {
      refetchFoldersIfUnsupported(qc, accountId, e)
      // 서버 message 가 없으면 문구만 — extractApiError 의 fallback 은 네트워크 안내를 덧붙여 spec 문구와 달라진다.
      toast.error(permanentDeleteFailureToast(apiErrorResponse(e)?.message || null))
    },
  })
}
