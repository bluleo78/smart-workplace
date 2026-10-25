// 메일함 화면 컨텍스트(WP-54) — 받은편지함(MailInboxPage)과 임시보관함(MailDraftsPage)이 같은 등록 훅을 쓴다.
import { useMemo } from 'react'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { buildMailContext, type MailContextInput } from '@/lib/aiScreenContext/builders/mail'

import type { EmailMessageSummary } from '../../types/mailMessage'

/**
 * WP-54 메일함 화면 컨텍스트 등록 — 원시값과 목록 행 요약만 받는 모듈 수준 훅.
 * 페이지 본문에 useMemo 를 두면 같은 계정에서 나온 값(본인 주소)을 다른 곳(전체답장 조립)에 넘기는 것만으로 React Compiler 가
 * 메모를 보존할 수 없다고 보므로, 등록을 이 훅으로 떼어 의존성이 여기서만 닫히게 한다(workplace-web CLAUDE.md 화면 컨텍스트 패턴).
 */
export function useMailScreenContext({
  accountId,
  accountEmail,
  folder,
  serverFolder,
  q,
  category,
  needsReply,
  count,
  selected,
}: Omit<MailContextInput, 'accountId' | 'selected'> & { accountId: number | null; selected: EmailMessageSummary | null }) {
  const screenContext = useMemo(
    () =>
      accountId != null
        ? buildMailContext({
            accountId,
            accountEmail,
            folder,
            serverFolder,
            q,
            category,
            needsReply,
            count,
            selected: selected
              ? {
                  id: selected.id,
                  subject: selected.subject,
                  fromName: selected.fromName,
                  fromAddress: selected.fromAddress ?? '',
                  receivedAt: selected.receivedAt ?? '',
                  aiCategory: selected.aiCategory,
                  aiNeedsReply: selected.aiNeedsReply,
                }
              : null,
          })
        : null,
    [accountId, accountEmail, folder, serverFolder, q, category, needsReply, count, selected],
  )
  useRegisterAiScreenContext(screenContext)
}
