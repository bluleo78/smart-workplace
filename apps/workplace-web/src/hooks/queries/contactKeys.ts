// 연락처 TanStack Query 키 팩토리.
import type { ContactTypeFilter } from '../../types/contact'

export const contactKeys = {
  all: ['contacts'] as const,
  list: (search: string, type: ContactTypeFilter, organization?: string, title?: string) =>
    ['contacts', 'list', { search, type, organization, title }] as const,
  facets: () => ['contacts', 'facets'] as const,
  member: (id: number) => ['contacts', 'member', id] as const,
  external: (id: number) => ['contacts', 'external', id] as const,
}
