// #80: 첨부 파일 드라이브 임포트 mutation 훅.

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { importAttachment } from '../../api/driveLinks'
import { handleApiError } from '../../lib/api-error'

interface ImportAttachmentVars {
  spaceId: number
  folderId: number | null
  fileId: number
}

/** 이슈/메시지 첨부 파일을 드라이브 공간(또는 폴더)으로 임포트. */
export function useImportAttachment() {
  return useMutation({
    mutationFn: ({ spaceId, folderId, fileId }: ImportAttachmentVars) =>
      importAttachment(spaceId, folderId, fileId),
    onSuccess: () => {
      // DrivePage 는 직접 API 호출 방식이라 쿼리 키가 없음 — 캐시 무효화 불필요.
      toast.success('파일을 드라이브로 가져왔습니다')
    },
    onError: (e) => handleApiError(e, '드라이브 임포트에 실패했습니다'),
  })
}
