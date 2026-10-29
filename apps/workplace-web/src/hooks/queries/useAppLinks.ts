// 채팅 앱 링크 카드 1장 조회(WP-896)와 우리 앱 호스트 설정(WP-1165) — 보는 사람 권한으로 그 순간 채운 카드 칸. 옵션(캐시 키·재시도)은 노트 칩(WP-1147)과 나눠 쓰는
// appLinkCardQuery 를 그대로 쓴다.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'

import { appLinkCardQuery, appLinksApi } from '@/api/appLinks'
import { type AppLink, currentAppHosts, setPublicAppHost, subscribeAppHosts } from '@/lib/appLinks'

/** 링크 대상의 카드 — 볼 수 없거나 없는 대상은 error(404·403, isAppLinkDenied)로 온다. */
export function useAppLinkCard(link: AppLink) {
  return useQuery(appLinkCardQuery(link))
}

/**
 * 앱 링크 판정 설정을 받아 공개 웹 주소 호스트를 정한다(WP-1165) — 로그인한 앱 셸(AppLayout)에서 한 번 부른다. 서버 설정은 배포 사이에 바뀌지
 * 않으니 다시 받지 않는다. 못 받으면 지금처럼 현재 호스트만 본다.
 */
export function useAppLinkConfig(): void {
  const { data } = useQuery({
    queryKey: ['app-link-config'],
    queryFn: appLinksApi.config,
    staleTime: Infinity,
    retry: 1,
  })
  useEffect(() => {
    if (data) setPublicAppHost(data.appHost)
  }, [data])
}

/** 지금 우리 앱 주소로 보는 호스트들 — 설정을 받아 공개 호스트가 더해지면 다시 그린다. */
export function useAppHosts(): readonly string[] {
  return useSyncExternalStore(subscribeAppHosts, currentAppHosts, currentAppHosts)
}
