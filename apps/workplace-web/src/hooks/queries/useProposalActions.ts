// L3 위임 확인 카드 — 제안 승인/거부 mutation 훅.
// 성공 시 해당 채널 메시지 목록을 무효화해 카드 상태(CONFIRMED/REJECTED)와 결과 메시지가 갱신된다.

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingApi } from '@/api/messaging'
import { messagingKeys } from '@/hooks/queries/messagingKeys'
import { handleApiError } from '@/lib/api-error'

/**
 * 제안 승인/거부 mutation 쌍. channelId 는 성공 후 메시지 목록 무효화 범위 지정에 사용.
 * @returns { confirm, reject } — mutate(proposalId) 호출로 각 동작 실행.
 */
export function useProposalActions(channelId: number) {
  const qc = useQueryClient()
  // 채널 메시지 목록 전체 무효화 — 카드 상태 + 결과 메시지(이슈 생성 완료 텍스트) 갱신.
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: messagingKeys.messages(channelId) })

  // confirm 은 { proposalId, arg? } 객체를 받아 승인 요청.
  // - 이슈: arg = projectKey(string) — 미전달 시 AI 추천 프로젝트 사용.
  // - 일정: arg = override 객체({ title?, startsAt?, endsAt?, location? }).
  const confirm = useMutation({
    mutationFn: ({
      proposalId,
      arg,
    }: {
      proposalId: number
      arg?: string | { title?: string; startsAt?: string; endsAt?: string; location?: string }
    }) => messagingApi.confirmProposal(proposalId, arg),
    onSuccess: invalidate,
    onError: (error: unknown) => handleApiError(error, '승인 실패'),
  })

  const reject = useMutation({
    mutationFn: (proposalId: number) => messagingApi.rejectProposal(proposalId),
    onSuccess: invalidate,
    onError: (error: unknown) => handleApiError(error, '거부 실패'),
  })

  return { confirm, reject }
}
