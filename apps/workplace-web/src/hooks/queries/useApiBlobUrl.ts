// #750: 인증이 필요한 /api/v1 콘텐츠 경로를 <img> 로 표시하기 위한 blob objectURL 훅.
// 액세스 토큰이 메모리 Bearer 라 브라우저가 직접 발행하는 <img> 요청에는 헤더가 실리지 않는다
// (api/client.ts, JwtAuthenticationFilter). 그래서 axios 로 받아 objectURL 로 바꾼다.
// 캐시 정책(retry:false, staleTime)만 useDriveThumbnail(#615) 과 동일 — objectURL 생성/revoke
// 라이프사이클은 이 훅이 처음이다. fetchBlobByPath 는 try/catch 가 없어 실패는 axios reject 로
// 전파되고 React Query 의 isError 로 나타난다(null 캐시 아님). 에러 쿼리는 data 가 없어 항상
// stale 이므로 재방문 시(refetchOnMount 기본값) 페이지당 1회는 재요청된다 — 이는 의도된
// 동작이다: 권한이 나중에 부여되면 자가 치유되고, retry:false 가 있어 폭주하지 않는다.

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { fetchBlobByPath } from '../../api/blobContent'

/**
 * 콘텐츠 경로 → blob object URL.
 * Blob 자체를 React Query 로 캐시하고, objectURL 은 컴포넌트 수명에 맞춰 만들고 revoke 한다
 * (objectURL 을 캐시에 넣으면 언마운트 시 revoke 된 URL 이 다음 마운트에 재사용돼 깨진다).
 */
export function useApiBlobUrl(path: string | null | undefined) {
  const enabled = Boolean(path)
  const { data, isPending, isError } = useQuery({
    queryKey: ['api-blob', path],
    queryFn: () => fetchBlobByPath(path as string),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!data) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(data)
    setUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [data])

  return { url, isPending: enabled && isPending, isError }
}
