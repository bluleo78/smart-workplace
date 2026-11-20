// 예약됨 화면(WP-1787) — 임시보관함 화면(MailDraftsPage)과 같은 마스터-디테일 틀에 예약 목록과 안내만 둔다.
// 행을 누르면 예약을 풀고 쓰기 창이 열리며, 검색·동기화·읽음 처리가 없어 메일함의 훅을 돌리지 않는다.
import { Page } from '@/components/layout/Page'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import { useMailDraftCount } from '../../hooks/queries/useMailDrafts'
import { MailScheduledDetailEmpty, MailScheduledList } from './MailScheduledList'
import { useMailScreenContext } from './useMailScreenContext'

/** 예약됨 — 헤더(제목만, 검색 없음) + 예약 목록 + 오른쪽 안내(데스크톱). */
export function MailScheduledPage({ accountId }: { accountId: number }) {
  const { data: accounts } = useMailAccounts()
  const accountEmail = accounts?.find((a) => a.id === accountId)?.emailAddress ?? null
  // AI 에는 목록이 아니라 예약 개수(사이드바 배지와 같은 개수 쿼리)를 알린다. 열린 메일·검색은 없다.
  const { data: countData } = useMailDraftCount(accountId)
  useMailScreenContext({
    accountId,
    accountEmail,
    folder: 'SCHEDULED',
    q: '',
    category: null,
    needsReply: false,
    count: countData?.scheduled,
    selected: null,
  })

  return (
    <Page>
      <Page.Header title="예약됨" />
      <Page.Body padded={false}>
        <div className="flex min-w-0 flex-1 flex-col border-r lg:max-w-md" data-testid="mail-list">
          <MailScheduledList accountId={accountId} />
        </div>
        <div className="hidden min-w-0 flex-1 lg:block" data-testid="mail-detail-pane">
          <MailScheduledDetailEmpty />
        </div>
      </Page.Body>
    </Page>
  )
}
