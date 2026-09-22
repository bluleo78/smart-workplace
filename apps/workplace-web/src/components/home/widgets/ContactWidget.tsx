import { Contact } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useContactDetail } from '@/hooks/queries/useContactDetail'
import type { ExternalContactDetail } from '@/types/contact'

import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'

/**
 * #460: 연락처 상세 위젯 — show_contact 지시를 받아 단일 외부 연락처 상세를 표시한다.
 * params.externalId 누락 시 재시도 없는 안내 메시지 렌더(정적 파라미터 오류라 재시도 무의미).
 * #840: 식별자는 externalId(외부 연락처 id) — 구성원 userId 와 혼동을 막기 위해 contactId 에서 개명했다.
 * 개명 이전에 저장된 대화 기록의 위젯 지시를 복원할 수 있도록 contactId 도 폴백으로 읽는다.
 * fetch 실패 시에는 WidgetError(onRetry) 로 재시도 허용.
 * AI 연락처 도메인은 외부 연락처이므로 type 은 'EXTERNAL' 로 고정한다.
 */
export default function ContactWidget({ params }: { params?: Record<string, unknown> }) {
  const raw = params?.externalId ?? params?.contactId
  const externalId = typeof raw === 'number' ? raw : null

  // externalId 누락 — 정적 파라미터 오류: 재시도 버튼 없이 안내 메시지만 표시.
  if (externalId === null) {
    return (
      <WidgetFrame title="연락처 상세">
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="contact-error"
        >
          <Contact className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">연락처 ID가 없습니다</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            연락처 ID를 지정하여 다시 요청해 보세요.
          </p>
        </div>
      </WidgetFrame>
    )
  }

  // externalId 존재 — ContactDetailContent 에서 훅을 호출(early return 이후 조건부 훅 금지 우회).
  return <ContactDetailContent externalId={externalId} />
}

/** externalId 가 확정된 경우의 데이터 로드·렌더 분리 컴포넌트(훅 규칙 준수). */
function ContactDetailContent({ externalId }: { externalId: number }) {
  // AI 연락처 도메인은 외부 연락처 — type 'EXTERNAL' 고정.
  const contact = useContactDetail({ type: 'EXTERNAL', id: externalId })

  if (contact.isLoading) {
    return (
      <WidgetFrame title="연락처 상세">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    )
  }
  if (contact.isError) {
    return (
      <WidgetFrame title="연락처 상세">
        <WidgetError onRetry={() => contact.refetch()} testId="contact-error" />
      </WidgetFrame>
    )
  }

  const detail = contact.data as ExternalContactDetail | undefined
  if (!detail) return null

  return (
    <WidgetFrame title="연락처 상세">
      <div className="flex flex-col gap-2 p-1" data-testid="contact-detail">
        {/* 이름 */}
        <div className="flex items-center gap-2">
          <Contact className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium text-sm">{detail.name}</span>
        </div>
        {/* 조직·직책 */}
        {(detail.organization || detail.title) && (
          <p className="text-xs text-muted-foreground">
            {[detail.organization, detail.title].filter(Boolean).join(' · ')}
          </p>
        )}
        {/* 이메일 */}
        {detail.email && (
          <p className="text-xs text-muted-foreground">{detail.email}</p>
        )}
        {/* 전화 */}
        {detail.phone && (
          <p className="text-xs text-muted-foreground">{detail.phone}</p>
        )}
        {/* 메모 */}
        {detail.notes && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{detail.notes}</p>
        )}
      </div>
    </WidgetFrame>
  )
}
