// 설정 영역 공용 페이지 래퍼 — Page 위 얇은 래퍼.
// 폼형(width='form')은 Page settings 폭(주석 섹션), 목록형은 전체 폭. 헤더·본문이 Page 여백(px-4)을 공유해 시작선이 맞는다(WP-397).
import { type ReactNode, useState } from 'react'

import { Page } from './Page'
import { SettingsScrollRootContext } from './settingsScrollRoot'

interface SettingsPageProps {
  title: ReactNode
  /** 제목 앞 컨트롤(목록으로 돌아가기 등) — Page.Header icon 으로 넘겨 데스크톱에만 그린다. 모바일은 상세 헤더의 ‹ 가 대신한다. */
  icon?: ReactNode
  /** 제목 옆 보조 메타(프로젝트 키 등) — Page.Header meta 로 넘긴다. */
  meta?: ReactNode
  actions?: ReactNode
  width?: 'form' | 'full'
  'data-testid'?: string
  children: ReactNode
}

export function SettingsPage({ title, icon, meta, actions, width = 'full', children, ...rest }: SettingsPageProps) {
  // 본문 스크롤 요소 — 콜백 ref(useState)라 마운트 후 하위 무한 스크롤 sentinel 이 root 로 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  return (
    <Page width={width === 'form' ? 'settings' : 'full'} data-testid={rest['data-testid'] ?? 'settings-page'}>
      <Page.Header title={title} icon={icon} meta={meta} actions={actions} />
      {/* 목록형은 배너·표 사이 간격(space-y-6)을 유지, 폼형은 섹션이 자체 여백·구분선을 가진다. */}
      <Page.Body scrollRef={setScrollEl} className={width === 'full' ? 'space-y-6' : undefined}>
        <SettingsScrollRootContext.Provider value={scrollEl}>{children}</SettingsScrollRootContext.Provider>
      </Page.Body>
    </Page>
  )
}
