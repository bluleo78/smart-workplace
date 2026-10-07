// 연락처 TanStack Query 키 팩토리.
import type { ContactTypeFilter } from '../../types/contact'

export const contactKeys = {
  all: ['contacts'] as const,
  list: (search: string, type: ContactTypeFilter, organization?: string, title?: string) =>
    ['contacts', 'list', { search, type, organization, title }] as const,
  // 첫 페이지 앞 limit 명(WP-160) — list 키 객체에 limit 을 더해 all·같은 필터 list 키(객체 부분 일치) 무효화가 닿는다.
  head: (search: string, type: ContactTypeFilter, organization: string | undefined, title: string | undefined, limit: number) =>
    ['contacts', 'list', { search, type, organization, title, limit }] as const,
  facets: () => ['contacts', 'facets'] as const,
  member: (id: number) => ['contacts', 'member', id] as const,
  external: (id: number) => ['contacts', 'external', id] as const,
}
