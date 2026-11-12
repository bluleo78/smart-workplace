// #80: 첨부 파일 「드라이브에 저장」 mutation 훅. WP-1400: 메일 첨부 저장도 같은 훅이 대상(DriveImportTarget)에 따라 고른다.

import { useMutation } from '@tanstack/react-query'

import { importAttachment } from '../../api/driveLinks'
import { saveMailAttachmentToDrive } from '../../api/mailMessages'
import type { DriveImportTarget } from '../../components/viewer/types'
import { handleApiError } from '../../lib/api-error'

interface ImportAttachmentVars {
  spaceId: number
  folderId: number | null
  target: DriveImportTarget
}

/**
 * 첨부를 드라이브 공간(또는 폴더)에 저장한다 — 이슈/메시지 업로드 첨부(kind 'file')는 import-attachment(같은 파일 공유),
 * 메일 첨부(kind 'mail')는 core file 행이 없어 메일 첨부 저장 API(메일 서버에서 받아 새 파일)로 보낸다.
 * 실패 안내는 한 문구다(같은 이름·한도 초과 409 는 서버 문구를 그대로 보인다).
 * 성공 안내(저장 위치·「열기」, WP-1525)는 화면·라우터에 기대므로 이 훅에 두지 않고 호출부(useImportToDrive)가 mutateAsync().then(...) 으로 띄운다.
 */
export function useImportAttachment() {
  return useMutation({
    mutationFn: ({ spaceId, folderId, target }: ImportAttachmentVars) =>
      target.kind === 'mail'
        ? saveMailAttachmentToDrive(target.mailAttachmentId, spaceId, folderId)
        : importAttachment(spaceId, folderId, target.fileId),
    // DrivePage 는 직접 API 호출 방식이라 쿼리 키가 없음 — 성공 시 캐시 무효화 불필요.
    onError: (e) => handleApiError(e, '드라이브에 저장하지 못했습니다'),
  })
}
