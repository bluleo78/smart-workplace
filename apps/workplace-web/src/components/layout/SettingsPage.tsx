// 설정 영역 공용 페이지 래퍼.
// 고정 PageHeader + 스크롤 본문. 폼형(width='form')은 좌측 max-w-2xl, 목록형은 풀폭.
// 모든 설정 페이지가 동일 헤더/정렬을 갖도록 단일화한다.
import { type ReactNode, useState } from 'react'

import { cn } from '@/lib/utils'

import { PageHeader } from './PageHeader'
import { SettingsScrollRootContext } from './settingsScrollRoot'

interface SettingsPageProps {
  title: ReactNode
  actions?: ReactNode
  width?: 'form' | 'full'
  'data-testid'?: string
  children: ReactNode
}

export function SettingsPage({
  title,
  actions,
  width = 'full',
  children,
  ...rest
}: SettingsPageProps) {
  // 본문 스크롤 요소 — 콜백 ref(useState)라 마운트 후 하위 무한 스크롤 sentinel 이 root 로 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid={rest['data-testid'] ?? 'settings-page'}
    >
      <PageHeader title={title} actions={actions} />
      <div ref={setScrollEl} className="flex-1 overflow-y-auto">
        {/* 좌측 정렬 고정. 폼형만 폭 제한(mx-auto 아님). */}
        <div className={cn('space-y-6 p-6', width === 'form' && 'max-w-2xl')}>
          <SettingsScrollRootContext.Provider value={scrollEl}>{children}</SettingsScrollRootContext.Provider>
        </div>
      </div>
    </div>
  )
}
