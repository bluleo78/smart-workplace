import { Contact } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useContacts } from '@/hooks/queries/useContacts'
import type { ContactSummary, ContactTypeFilter } from '@/types/contact'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

/**
 * #460: 연락처 목록 위젯 — show_contacts 지시를 받아 연락처 목록을 표시한다.
 * params: { search?, type?, org?, title? }
 * org 파라미터는 useContacts 의 organization 인자로 매핑한다.
 * 무한스크롤 없이 첫 페이지(최대 20개)만 표시.
 */
export default function ContactsWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: ContactSummary[]
}) {
  const search = (params?.search as string) ?? ''
  // type 없으면 전체 조회 'ALL' 기본값 적용.
  const typeFilter = ((params?.type as ContactTypeFilter) || 'ALL') as ContactTypeFilter
  // show_contacts 에서 'org' 로 전달 — useContacts 의 organization 인자로 매핑.
  const org = (params?.org as string) || undefined
  const title = (params?.title as string) || undefined

  const { data, isLoading, isError, refetch } = useContacts(search, typeFilter, org, title, {
    enabled: !previewData,
  })

  if (!previewData && isLoading) {
    return (
      <WidgetFrame title="연락처">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (!previewData && isError) {
    return (
      <WidgetFrame title="연락처">
        <WidgetError onRetry={() => refetch()} testId="contacts-error" />
      </WidgetFrame>
    )
  }

  // 첫 페이지의 items 배열만 사용(최대 20개, 무한스크롤 없음).
  const items = (previewData ?? data?.pages?.[0]?.items ?? []).slice(0, 20)

  return (
    <WidgetFrame title="연락처">
      {items.length > 0 ? (
        <ul className="divide-y" data-testid="contacts-items">
          {items.map((c) => (
            <li key={`${c.type}-${c.id}`}>
              {/* 연락처 목록 → /contacts 딥링크 */}
              <Link
                to="/contacts"
                aria-label={`연락처: ${c.name}`}
                className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
              >
                <Contact className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {/* 이름 */}
                <span className="w-24 shrink-0 truncate font-medium">{c.name}</span>
                {/* 조직·직책 — 둘 다 없으면 공백 */}
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                  {[c.organization, c.title].filter(Boolean).join(' / ')}
                </span>
                {/* 이메일 */}
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {c.email ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="contacts-empty"
        >
          <Contact className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">연락처가 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            조건에 맞는 연락처가 없습니다.
          </p>
        </div>
      )}
    </WidgetFrame>
  )
}
