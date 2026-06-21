// #80: 이슈 드라이브 링크 조회·추가·제거 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  addIssueDriveLink,
  listIssueDriveLinks,
  removeIssueDriveLink,
} from '../../api/driveLinks'
import { handleApiError } from '../../lib/api-error'

/** 이슈에 연결된 드라이브 파일 목록 구독. */
export function useIssueDriveLinks(projectKey: string, number: number) {
  return useQuery({
    queryKey: ['issue-drive-links', projectKey, number],
    queryFn: () => listIssueDriveLinks(projectKey, number),
    enabled: !!projectKey && number > 0,
  })
}

/** 이슈에 드라이브 파일 링크 추가 mutation. */
export function useAddIssueDriveLink(projectKey: string, number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (driveFileId: number) => addIssueDriveLink(projectKey, number, driveFileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-drive-links', projectKey, number] })
      toast.success('드라이브 파일을 링크했습니다')
    },
    onError: (e) => handleApiError(e, '드라이브 링크에 실패했습니다'),
  })
}

/** 이슈 드라이브 링크 제거 mutation. */
export function useRemoveIssueDriveLink(projectKey: string, number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (driveFileId: number) => removeIssueDriveLink(projectKey, number, driveFileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-drive-links', projectKey, number] })
      toast.success('링크를 제거했습니다')
    },
    onError: (e) => handleApiError(e, '링크 제거에 실패했습니다'),
  })
}
