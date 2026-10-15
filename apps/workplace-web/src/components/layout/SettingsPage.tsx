// 설정 영역 공용 페이지 래퍼 — Page 위 얇은 래퍼.
// 폼형(width='form')은 Page settings 폭(주석 섹션), 목록형은 전체 폭. 헤더·본문이 Page 여백(px-4)을 공유해 시작선이 맞는다(WP-397).
// 폼형에 guide 가 있으면 화면별 설정 가이드를 붙인다 — 상태·요소는 useSettingsGuide 가 만들고 여기선 제자리에 꽂기만 한다(WP-399).
import { type ReactNode, useState } from 'react'

import type { SettingsGuide } from '@/components/settings-guide/types'
import { useSettingsGuide } from '@/components/settings-guide/useSettingsGuide'

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
  /** 화면별 설정 가이드 — width='form' 일 때만 그린다(목록형엔 남는 여백이 없어 무시). */
  guide?: SettingsGuide
  'data-testid'?: string
  children: ReactNode
}

export function SettingsPage({ title, icon, meta, actions, width = 'full', guide, children, ...rest }: SettingsPageProps) {
  // 본문 스크롤 요소 — 콜백 ref(useState)라 마운트 후 하위 무한 스크롤 sentinel 이 root 로 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const guideUi = useSettingsGuide(width === 'form' ? guide : undefined, scrollEl)
  // 데스크톱: 가이드 버튼을 기존 actions 앞에. 모바일: 가이드 버튼은 ⋯ 밖 인라인(mobilePrimaryAction)이고 ⋯ 엔 기존 actions 만 담긴다.
  const headerActions = guideUi?.desktopButton ? <>{guideUi.desktopButton}{actions}</> : actions

  return (
    <Page width={width === 'form' ? 'settings' : 'full'} data-testid={rest['data-testid'] ?? 'settings-page'}>
      <Page.Header title={title} icon={icon} meta={meta} actions={headerActions} mobilePrimaryAction={guideUi?.mobileButton} />
      {/* 본문 영역 상자(relative) — 데스크톱 가이드 시트가 이 안에 absolute 로 떠 헤더 아래·AI 옆 패널 왼쪽에만 걸친다. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Page.Body
          scrollRef={setScrollEl}
          // 목록형은 배너·표 사이 간격(space-y-6)을 유지, 폼형은 섹션이 자체 여백·구분선을 가진다.
          className={width === 'full' ? 'space-y-6' : undefined}
          // 가이드 화면은 열이 없어도 null 로 슬롯을 유지한다 — 열↔버튼 전환 때 폼이 리마운트되어 입력값이 날아가지 않게.
          aside={guideUi?.aside}
        >
          <SettingsScrollRootContext.Provider value={scrollEl}>{children}</SettingsScrollRootContext.Provider>
        </Page.Body>
        {guideUi?.desktopSheet}
      </div>
      {guideUi?.mobileSheet}
    </Page>
  )
}
