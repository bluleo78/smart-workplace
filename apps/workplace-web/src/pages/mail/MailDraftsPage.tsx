// 임시보관함 화면(WP-577) — 메일함과 같은 마스터-디테일 틀에 임시저장 목록과 안내만 둔다.
// 행을 누르면 상세 패널이 아니라 작성창이 열리고, 검색·동기화·읽음 처리가 없어 메일함의 훅을 돌리지 않는다.
import { Page } from '@/components/layout/Page'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import { useMailDraftCount } from '../../hooks/queries/useMailDrafts'
import { MailDraftsDetailEmpty, MailDraftsList } from './MailDraftsList'
import { useMailScreenContext } from './useMailScreenContext'

/** 임시보관함 — 헤더(제목만, 검색 없음) + 임시저장 목록 + 오른쪽 안내(데스크톱). */
export function MailDraftsPage({ accountId }: { accountId: number }) {
  const { data: accounts } = useMailAccounts()
  const accountEmail = accounts?.find((a) => a.id === accountId)?.emailAddress ?? null
  // AI 에는 메시지 목록이 아니라 임시저장 개수를 알린다(사이드바 배지와 같은 개수 쿼리 — 목록 상한과 무관한 전체 개수, 저장마다 바뀌지 않는다).
  // 열린 메일·검색은 없다.
  const { data: countData } = useMailDraftCount(accountId)
  useMailScreenContext({
    accountId,
    accountEmail,
    folder: 'DRAFTS',
    q: '',
    category: null,
    needsReply: false,
    count: countData?.count,
    selected: null,
  })

  return (
    <Page>
      {/* 임시보관함은 검색하지 않는다(임시저장 목록 API 에 검색어가 없다) — 검색 입력·모바일 🔍 를 두지 않는다. */}
      <Page.Header title="임시보관함" />
      <Page.Body padded={false}>
        <div className="flex min-w-0 flex-1 flex-col border-r lg:max-w-md" data-testid="mail-list">
          <MailDraftsList accountId={accountId} />
        </div>
        {/* 행이 작성창을 열므로 상세 대신 안내만 둔다(좁은 화면에서는 숨김). */}
        <div className="hidden min-w-0 flex-1 lg:block" data-testid="mail-detail-pane">
          <MailDraftsDetailEmpty />
        </div>
      </Page.Body>
    </Page>
  )
}
