import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { driveApi } from '../../api/drive'
import type { DriveSpace } from '../../types/drive'
import { driveKeys } from './driveKeys'

/**
 * 공간 조회 실패 토스트 id — 고정 id 라 같은 실패를 알리는 여러 화면(통합 뷰어·첨부 모아보기·이슈 첨부 스트립)이
 * 동시에·반복해 알려도 화면에는 한 개만 보인다(뷰어를 다시 열어도 쌓이지 않음).
 */
const SPACES_ERROR_TOAST_ID = 'drive-spaces-load-error'

// #460: 드라이브 스페이스 목록 — show_drive(spaceId 미지정) 위젯용.
// errorToast: 조회 실패를 토스트로 알릴지(opt-in). 가져오기·링크처럼 개인 공간이 있어야 하는 기능만 켠다 —
// 사이드바·위젯 등 다른 사용처는 예전처럼 조용히 둔다.
export function useDriveSpaces(options?: { enabled?: boolean; errorToast?: boolean }) {
  const query = useQuery<DriveSpace[]>({
    queryKey: driveKeys.spaces(),
    queryFn: () => driveApi.listSpaces().then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  })
  const toastOnError = !!options?.errorToast && query.isError
  useEffect(() => {
    if (toastOnError) toast.error('드라이브 스페이스를 불러오지 못했습니다.', { id: SPACES_ERROR_TOAST_ID })
  }, [toastOnError])
  return query
}
