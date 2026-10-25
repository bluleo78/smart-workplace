// WP-579 설정 › 앱 설정 › 노트(WP-887 에서 「워크스페이스 관리 › 노트 공유」를 옮김) — 외부 공유 허용 정책과 워크스페이스 전체 공유 목록(일괄 해제).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { wikiApi } from '@/api/wiki'
import { BusySwitch } from '@/components/BusySwitch'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { WikiRevokeSharesDialog } from '@/components/wiki/WikiRevokeSharesDialog'
import { ADMIN_SHARE_LIST_CAP, countLivePublicShares } from '@/components/wiki/wikiShare'
import { WikiShareTable } from '@/components/wiki/WikiShareTable'
import { wikiKeys } from '@/hooks/queries/wikiKeys'
import { handleApiError } from '@/lib/api-error'

export default function WikiSharingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const policy = useQuery({ queryKey: wikiKeys.sharePolicy(), queryFn: () => wikiApi.getSharePolicy().then((r) => r.data) })
  const list = useQuery({ queryKey: wikiKeys.allShares(), queryFn: () => wikiApi.listAllShares().then((r) => r.data) })
  // 끄면 막히는 외부 링크 수 — 목록을 아직 못 받았으면(로딩·오류) 모른다(null) → 몇 개인지 못 박지 않고 확인만 받는다.
  const publicCount = list.data ? countLivePublicShares(list.data) : null
  // 서버는 최신 500건만 준다 — 꽉 찼으면 더 있을 수 있어 알린다(그 밖의 것은 정책을 끄면 함께 막힌다).
  const capped = (list.data?.length ?? 0) >= ADMIN_SHARE_LIST_CAP
  const [confirmOff, setConfirmOff] = useState(false)
  const [targets, setTargets] = useState<number[]>([])

  const setPolicy = useMutation({
    mutationFn: (enabled: boolean) => wikiApi.saveSharePolicy(enabled).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(wikiKeys.sharePolicy(), data)
      void qc.invalidateQueries({ queryKey: wikiKeys.allShares() })
    },
    onError: (e) => handleApiError(e, '외부 공유 설정을 바꾸지 못했습니다'),
  })
  const revoke = useMutation({
    mutationFn: (pageIds: number[]) => wikiApi.revokeShares(pageIds),
    onSuccess: () => {
      toast.success('공유를 해제했습니다')
      void qc.invalidateQueries({ queryKey: wikiKeys.all })
    },
    onError: (e) => handleApiError(e, '공유를 해제하지 못했습니다'),
  })

  // 끌 때 — 막힐 외부 링크가 있거나 몇 개인지 모르면 알리고 확인받는다(없다고 확인된 때만 바로 끈다).
  const onToggle = (next: boolean) => {
    if (!next && publicCount !== 0) setConfirmOff(true)
    else setPolicy.mutate(next)
  }

  return (
    <SettingsPage title="노트" width="full" data-testid="wiki-sharing-admin-page">
      <SettingsSection
        title="외부 공유"
        description="켜 두면 구성원이 노트 페이지를 로그인 없이 볼 수 있는 링크로 공유할 수 있어요(보기만). 끄면 지금 있는 외부 링크가 모두 바로 막히고, 다시 켜도 되살아나지 않아요."
      >
        <SettingsToggleRow
          label={<span id="wiki-external-share-label">외부 공유 허용</span>}
          control={
            <BusySwitch
              aria-labelledby="wiki-external-share-label"
              data-testid="wiki-external-share-switch"
              checked={policy.data?.externalShareEnabled ?? false}
              // 설정을 못 불러왔을 때 「꺼짐」으로 보이지 않게 잠근다 — 잘못된 값 위에서 켜고 끄지 않도록.
              disabled={!policy.data}
              busy={setPolicy.isPending}
              onCheckedChange={onToggle}
            />
          }
        />
        {policy.isError && (
          <p className="text-sm text-destructive" data-testid="wiki-external-share-error">
            외부 공유 설정을 불러오지 못했습니다. 새로고침해 주세요.
          </p>
        )}
      </SettingsSection>
      <SettingsSection title="공유 중인 페이지" description="워크스페이스 전체에서 링크로 공유 중인 노트 페이지예요. 여러 개를 골라 한 번에 해제할 수 있어요.">
        <WikiShareTable
          items={list.data}
          isPending={list.isPending}
          isError={list.isError}
          showCreator
          selectable
          onOpenPage={(i) => navigate(`/wiki/spaces/${i.spaceId}/pages/${i.pageId}`)}
          onRevoke={setTargets}
          revoking={revoke.isPending}
        />
        {capped && (
          <p className="text-xs text-muted-foreground" data-testid="wiki-share-cap-note">
            최근 {ADMIN_SHARE_LIST_CAP}개까지만 보여요. 오래된 공유는 목록에 없을 수 있어요.
          </p>
        )}
      </SettingsSection>
      <WikiRevokeSharesDialog
        count={targets.length}
        onCancel={() => setTargets([])}
        onConfirm={() => {
          revoke.mutate(targets)
          setTargets([])
        }}
      />
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent data-testid="wiki-external-share-off-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>외부 공유를 끌까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {publicCount === null
                ? '지금 외부에 공개된 링크가 모두 바로 막힙니다.'
                : capped
                  ? // 목록이 잘렸으면 센 수는 하한이다 — 정확한 수처럼 말하지 않는다.
                    `지금 외부에 공개된 링크가 최소 ${publicCount}개 바로 막힙니다.`
                  : `지금 외부에 공개된 링크 ${publicCount}개가 바로 막힙니다.`}{' '}
              나중에 다시 켜도 되살아나지 않아 다시 공유해야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => setPolicy.mutate(false)}>
              끄기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
