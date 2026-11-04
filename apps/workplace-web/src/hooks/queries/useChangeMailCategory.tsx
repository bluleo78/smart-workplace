// WP-1341 메일 분류 바꾸기 훅 — 메뉴(MailCategoryMenu)·시트(MailCategorySheet)가 고른 분류를 저장하고 바꾼 직후 알림 두 개를 띄운다.
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { deleteAiMemory, updateAiMemory } from '@/api/aiMemories'
import { learnMailCategory, setMailCategory } from '@/api/mailMessages'
import { handleApiError } from '@/lib/api-error'
import { directionParticle } from '@/lib/utils'
import type { EmailMessageDetail, MailCategoryChange, MailCategoryState } from '@/types/mailMessage'

import { mailMessageKeys } from './mailMessageKeys'
import { aiMemoryKeys } from './useAiMemories'
import { invalidateMailCounts } from './useMailMessages'

/** 기억 알림은 문장을 읽고 [기억 취소]를 누를 시간이 필요해 기본(약 4초)보다 오래 둔다. */
const MEMORY_TOAST_MS = 8000

/** 학습이 남긴 기억 — [기억 취소]·[되돌리기]가 되돌릴 대상. previousContent 가 null 이면 새로 만든 기억(지운다). */
interface LearnedMemory {
  memoryId: number
  previousContent: string | null
  toastId: string | number
}

/**
 * 한 번의 분류 바꾸기 상태 — [되돌리기]가 학습 결과까지 되돌리게 한다.
 * undone: [되돌리기]를 눌렀다(아직 학습 응답이 안 왔으면 응답이 오는 대로 조용히 되돌린다).
 * memory: 학습이 만든·고친 기억(알림을 띄웠고 아직 취소하지 않았을 때만).
 */
interface ChangeSession {
  undone: boolean
  memory: LearnedMemory | null
}

/**
 * 분류 바꾸기 훅 — 돌려주는 함수가 순서대로 한다. 이미 지금 분류를 다시 고르면 아무것도 하지 않는다(저장·알림 없음 —
 * 같은 값으로 저장하면 「바꿨어요」 알림과 학습이 헛돈다. 메뉴·시트가 각자 막지 않고 여기 한 곳에서 막는다).
 *  1. PUT(나에게만 적용) 2. 이 계정 목록·안 읽은 수 다시 받기 + 열린 상세는 PUT 응답으로 바로 고치기
 *  3. 「분류를 ○○(으)로 바꿨어요 [되돌리기]」 4. learnable 이면 학습 → CREATE·UPDATE 일 때만 기억 알림.
 * [되돌리기]는 바꾸기 전의 *직접* 분류(없었으면 null = AI 분류)로 다시 저장한다 — 바꾸기 전에 보이던 AI 분류를 직접 분류로 굳히지 않게.
 * [되돌리기]는 바꾸기 전체를 되돌린다 — 학습이 기억을 남겼으면 그 기억도 되돌리고 기억 알림을 닫는다. 학습이 아직 진행 중이면
 * 응답이 오는 대로 알림 없이 되돌린다(교정을 취소했는데 그 교정에서 배운 기억만 남으면 안 된다).
 * 학습 실패는 분류 변경을 실패로 만들지 않는다(조용히 넘긴다 — 서버도 실패를 NONE 으로 돌려준다).
 */
export function useChangeMailCategory(accountId: number | undefined) {
  const qc = useQueryClient()
  // 분류가 바뀌면 분류별 보기 목록·안 읽은 수·열린 상세(메뉴 글자)가 함께 바뀐다. 목록은 이 계정 것만 다시 받고(다른 메일 훅과 같은 키),
  // 상세는 PUT 응답(유효 분류·직접 분류 여부)으로 캐시를 바로 고친다 — 본문까지 다시 받을 이유가 없다.
  const refresh = (messageId: number, change: MailCategoryChange) => {
    void qc.invalidateQueries({ queryKey: accountId == null ? ['mail-messages'] : ['mail-messages', accountId] })
    qc.setQueryData<EmailMessageDetail>(mailMessageKeys.detail(messageId), (old) =>
      old ? { ...old, aiCategory: change.aiCategory, categoryByMe: change.categoryByMe } : old,
    )
    invalidateMailCounts(qc)
  }
  // 기억 되돌리기 — 새 기억은 지우고, 고친 기억은 이전 문장으로 되돌린다([기억 취소]·[되돌리기] 공용).
  const revertMemory = async (memoryId: number, previousContent: string | null) => {
    try {
      if (previousContent != null) await updateAiMemory(memoryId, { content: previousContent })
      else await deleteAiMemory(memoryId)
      void qc.invalidateQueries({ queryKey: aiMemoryKeys.all })
    } catch (e) {
      handleApiError(e, '기억을 취소하지 못했어요')
    }
  }
  // 학습 — 개인 비서가 「왜 틀렸는지」를 메일 기억으로 남긴다. 기억할 것이 없으면(NONE·204) 알림 없음.
  const learn = async (session: ChangeSession, messageId: number, fromCategory: string | null, toCategory: string) => {
    let result
    try {
      result = await learnMailCategory(messageId, { fromCategory, toCategory })
    } catch {
      return
    }
    if (!result || result.action === 'NONE' || result.memoryId == null || !result.content) return
    const { memoryId } = result
    const previous = result.action === 'UPDATE' ? result.previousContent : null
    // 응답 전에 [되돌리기]를 눌렀다 — 알림 없이 기억만 되돌린다.
    if (session.undone) {
      await revertMemory(memoryId, previous)
      return
    }
    void qc.invalidateQueries({ queryKey: aiMemoryKeys.all })
    const toastId = toast(`AI 비서가 기억했어요: ${result.content}`, {
      icon: <Sparkles className="size-4 text-ai-accent" aria-hidden />,
      duration: MEMORY_TOAST_MS,
      action: {
        label: '기억 취소',
        onClick: () => {
          session.memory = null // [되돌리기]가 같은 기억을 한 번 더 되돌리지 않게
          void revertMemory(memoryId, previous)
        },
      },
    })
    session.memory = { memoryId, previousContent: previous, toastId }
  }
  // [되돌리기] — 분류를 되돌리고, 학습이 남긴 기억이 있으면 그 기억도 되돌리며 기억 알림을 닫는다.
  const undo = (session: ChangeSession, messageId: number, undoTo: string | null) => {
    session.undone = true
    setMailCategory(messageId, undoTo).then(
      (change) => refresh(messageId, change),
      (e) => handleApiError(e, '분류를 되돌리지 못했어요'),
    )
    const memory = session.memory
    if (memory) {
      session.memory = null
      toast.dismiss(memory.toastId)
      void revertMemory(memory.memoryId, memory.previousContent)
    }
  }
  return async (messageId: number, category: string | null, before: MailCategoryState) => {
    if (category != null && category === before.aiCategory) return // 지금 분류를 다시 골랐다 — 바꿀 것이 없다
    let change
    try {
      change = await setMailCategory(messageId, category)
    } catch (e) {
      handleApiError(e, '분류를 바꾸지 못했어요')
      return
    }
    refresh(messageId, change)
    const session: ChangeSession = { undone: false, memory: null }
    // 되돌린 뒤 분류가 없으면(AI 분류도 없음) 알릴 분류 이름이 없어 알림을 띄우지 않는다 — 메뉴 글자가 「분류」로 바뀐다.
    if (change.aiCategory) {
      const undoTo = before.categoryByMe ? before.aiCategory : null
      toast(`분류를 ${change.aiCategory}${directionParticle(change.aiCategory)} 바꿨어요`, {
        action: { label: '되돌리기', onClick: () => undo(session, messageId, undoTo) },
      })
    }
    if (change.learnable && category != null) await learn(session, messageId, before.aiCategory, category)
  }
}
