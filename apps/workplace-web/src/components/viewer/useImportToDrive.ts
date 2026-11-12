import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createElement, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { driveSpacesQueryOptions, SPACES_ERROR_MESSAGE, SPACES_ERROR_TOAST_ID } from '../../hooks/queries/useDriveSpaces'
import { useImportAttachment } from '../../hooks/queries/useImportAttachment'
import { spaceDisplayName } from '../../lib/driveSpaces'
import type { DriveSpace } from '../../types/drive'
import { FolderPickerModal } from '../drive/FolderPickerModal'
import { driveFilePath } from './driveOpen'
import type { DriveImportTarget } from './types'

/** 저장을 누를 때 공간 목록 캐시를 그대로 쓰는 시간 — 연타·연속 저장에서 같은 목록을 다시 받지 않게 한다. */
const SPACES_STALE_MS = 60_000

/**
 * 「드라이브에 저장」 공용 흐름(WP-277, 이름 WP-1525) — 개인 공간 조회 → 폴더 선택 모달 → 저장.
 * 첨부 모아보기(DriveAttachmentsView)와 통합 뷰어(☁)가 같은 흐름을 쓰도록 한 곳에 둔다.
 * - 공간 조회는 사용자가 저장을 누를 때(begin)만 한다(WP-1400). 미리보기를 열 때마다 조회하면 첨부를 보기만 해도
 *   요청이 나가고, 드라이브가 내려가 있으면 누르지도 않은 기능의 실패 토스트가 뜬다. 조회 실패·개인 공간 없음은 누른 뒤에 토스트로 알린다.
 * - picker 는 호출부가 원하는 위치(뷰어 Dialog 안 등)에 그린다 — 포커스 트랩 안에 두기 위해.
 * - 대상은 태그(DriveImportTarget)로 받는다(WP-1400) — 업로드 첨부는 import-attachment, 메일 첨부는 메일 첨부 저장 API.
 *   폴더 선택까지는 같고 확정할 때 mutation 훅(useImportAttachment)이 갈라 보낸다.
 * - 성공 토스트(WP-1525)는 여기서 띄운다 — 저장 위치(「내 드라이브 / 폴더 / 하위」)와 「열기」(드라이브 그 폴더에서 저장한 파일 미리보기).
 *   mutation 훅은 화면·라우터를 모르게 두고, 위치 문구에 필요한 공간·폴더 경로를 아는 이곳이 맡는다. 라우터 안에서만 쓴다(useNavigate).
 */
export function useImportToDrive() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const importMut = useImportAttachment()
  // 폴더 창을 띄울 대상과 그 개인 공간 — 공간 조회가 끝나 개인 공간이 확인된 뒤에만 채운다.
  const [pending, setPending] = useState<{ target: DriveImportTarget; space: DriveSpace } | null>(null)
  // 누른 뒤 공간 조회 중 — 그동안 버튼을 막아 연타로 조회·창이 겹치지 않게 한다.
  const [busy, setBusy] = useState(false)

  const begin = async (next: DriveImportTarget) => {
    if (busy) return
    setBusy(true)
    try {
      // 60초 안에 받은 목록이 있으면 그대로 쓴다 — ☁ 를 연달아 눌러도 매번 /drive/spaces 를 다시 받지 않는다.
      // 그 사이 권한·공간이 바뀌어 낡은 id 를 고르더라도 저장 요청에서 서버가 404/403 으로 막는다. 진행 중 조회는 react-query 가 합친다.
      const spaces = await queryClient.fetchQuery({ ...driveSpacesQueryOptions(), staleTime: SPACES_STALE_MS })
      const personal = spaces.find((s) => s.type === 'PERSONAL')
      if (personal == null) {
        // 권한 없음 등으로 개인 공간이 없다 — 예전엔 버튼 비활성 + title 로만 알렸던 사유를 누른 뒤 토스트로 알린다.
        toast.error('드라이브를 사용할 수 없습니다', { id: SPACES_ERROR_TOAST_ID })
        return
      }
      setPending({ target: next, space: personal })
    } catch {
      // 고정 id — 이슈 첨부 스트립 등 같은 실패를 알리는 다른 화면과 겹쳐 쌓이지 않는다.
      toast.error(SPACES_ERROR_MESSAGE, { id: SPACES_ERROR_TOAST_ID })
    } finally {
      setBusy(false)
    }
  }

  const picker: ReactNode =
    pending != null
      ? createElement(FolderPickerModal, {
          spaceId: pending.space.id,
          title: '저장할 폴더 선택',
          mode: 'folder',
          onConfirm: (folderId: number | null, folderPath: string[]) => {
            const spaceId = pending.space.id
            // 위치 문구 — 루트면 공간 이름만, 하위면 「공간 / 폴더 / 하위」. 개인 공간은 사이드바와 같은 「내 드라이브」로 보인다.
            const location = [spaceDisplayName(pending.space), ...folderPath].join(' / ')
            // mutate 의 호출별 onSuccess 대신 mutateAsync 를 쓴다 — 호출별 콜백은 응답 전에 뷰어를 닫아 이 훅이 언마운트되면
            // 불리지 않아 성공 토스트가 사라진다. 실패 토스트는 훅의 onError 가 띄우므로 여기서는 거절만 삼킨다.
            importMut
              .mutateAsync({ spaceId, folderId, target: pending.target })
              .then((saved) => {
                // 「열기」 주소는 고른 폴더가 아니라 저장 응답(folderId·id)으로 만든다 — 서버가 실제로 둔 곳을 연다.
                toast.success('드라이브에 저장했습니다', {
                  description: location,
                  action: { label: '열기', onClick: () => navigate(driveFilePath(spaceId, saved.folderId, saved.id)) },
                })
              })
              .catch(() => {})
            setPending(null)
          },
          onClose: () => setPending(null),
        })
      : null

  return {
    /** 누른 뒤 공간을 조회하는 중 — 버튼을 잠시 막는다. */
    busy,
    /** 개인 공간을 조회해 폴더 선택 모달을 연다(실패·개인 공간 없음은 토스트). */
    begin: (next: DriveImportTarget) => void begin(next),
    picker,
  }
}
