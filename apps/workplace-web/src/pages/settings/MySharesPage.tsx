// WP-579 설정 › 내 공유 — 내가 만든 노트 공유 링크를 스페이스와 상관없이 한곳에서 보고 거둔다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { wikiApi } from '@/api/wiki'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { WikiRevokeSharesDialog } from '@/components/wiki/WikiRevokeSharesDialog'
import { WikiShareTable } from '@/components/wiki/WikiShareTable'
import { wikiKeys } from '@/hooks/queries/wikiKeys'
import { handleApiError } from '@/lib/api-error'

export default function MySharesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: wikiKeys.myShares(), queryFn: () => wikiApi.listMyShares().then((r) => r.data) })
  // 해제할 페이지들 — 확인 창이 열려 있는 동안만.
  const [targets, setTargets] = useState<number[]>([])
  const revoke = useMutation({
    // 내 공유는 페이지 하나씩 해제(관리자 일괄 해제와 달리 페이지 공유 API 를 그대로 쓴다).
    mutationFn: (pageIds: number[]) => Promise.all(pageIds.map((id) => wikiApi.deleteShare(id))),
    onSuccess: () => toast.success('공유를 해제했습니다'),
    onError: (e) => handleApiError(e, '공유를 해제하지 못했습니다'),
    // 여러 건 중 일부만 풀렸을 수 있어 성공·실패와 상관없이 목록을 다시 받는다.
    onSettled: () => void qc.invalidateQueries({ queryKey: wikiKeys.all }),
  })
  return (
    <SettingsPage title="내 공유" width="full" data-testid="my-shares-page">
      <p className="text-sm text-muted-foreground">
        내가 링크로 공유한 노트 페이지입니다. 설정을 바꾸려면 페이지를 열고 「공유 중」을 누르세요.
      </p>
      <WikiShareTable
        items={list.data}
        isPending={list.isPending}
        isError={list.isError}
        showCreator={false}
        selectable={false}
        onOpenPage={(i) => navigate(`/wiki/spaces/${i.spaceId}/pages/${i.pageId}`)}
        onRevoke={setTargets}
        revoking={revoke.isPending}
      />
      <WikiRevokeSharesDialog
        count={targets.length}
        onCancel={() => setTargets([])}
        onConfirm={() => {
          revoke.mutate(targets)
          setTargets([])
        }}
      />
    </SettingsPage>
  )
}
