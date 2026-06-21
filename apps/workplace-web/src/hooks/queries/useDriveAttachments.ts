// #80: 가상 첨부 뷰 cursor 페이징 훅 — useInfiniteQuery 사용.

import { useInfiniteQuery } from '@tanstack/react-query'

import { listDriveAttachments } from '../../api/driveLinks'
import type { VirtualAttachmentPage } from '../../types/drive'

interface DriveAttachmentsParams {
  source?: 'ALL' | 'ISSUE' | 'MESSAGE'
  q?: string
  limit?: number
}

/** 이슈/메시지 업로드 파일의 가상 첨부 목록 — cursor 기반 무한 스크롤. */
export function useDriveAttachments(params: DriveAttachmentsParams = {}) {
  return useInfiniteQuery<VirtualAttachmentPage>({
    queryKey: ['drive-attachments', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listDriveAttachments({
        source: params.source,
        q: params.q || undefined,
        limit: params.limit,
        cursor: pageParam as string | undefined,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })
}
