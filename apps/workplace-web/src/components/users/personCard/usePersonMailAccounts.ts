// 사람 단추 줄의 메일 계정 목록(WP-1769) — PersonActionButtons 와, 그 줄보다 먼저 받아 두는 사람 카드가 함께 쓴다.
import { useMailAccounts } from '@/hooks/queries/useMailAccounts'
import { useAuth } from '@/hooks/useAuth'

/**
 * 단추 줄의 메일 계정 목록 — 메일 단추는 다른 사람(HUMAN)에게만 있어 AI·나는 받지 않는다.
 * 카드가 프로필 요청과 병렬로 미리 받을 때도 이 훅을 불러, 받는 조건이 단추 줄과 어긋나지 않게 한 곳에 둔다.
 */
export function usePersonMailAccounts(kind: 'HUMAN' | 'AGENT' | undefined, personId: number) {
  const { user } = useAuth()
  return useMailAccounts({ enabled: kind === 'HUMAN' && user?.id !== personId })
}
