// #80: 드라이브 파일 백링크(이슈/메시지 참조) 조회 훅.

import { useQuery } from '@tanstack/react-query'

import { listFileBacklinks } from '../../api/driveLinks'

/** 드라이브 파일이 참조된 이슈·메시지 목록 구독. */
export function useFileBacklinks(driveFileId: number) {
  return useQuery({
    queryKey: ['drive-file-backlinks', driveFileId],
    queryFn: () => listFileBacklinks(driveFileId),
    enabled: Number.isFinite(driveFileId) && driveFileId > 0,
  })
}
