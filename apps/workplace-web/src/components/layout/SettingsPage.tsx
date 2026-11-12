// 설정 영역 공용 페이지 래퍼 — Page 위 얇은 래퍼.
// 폼형(width='form')은 Page settings 폭(주석 섹션), 목록형은 전체 폭. 헤더·본문이 Page 여백(px-4)을 공유해 시작선이 맞는다(WP-397).
// 화면 설명은 매뉴얼 도움말 절이 가진다(WP-1507·1508) — 헤더 「도움말」 패널이 보이고, 이 래퍼는 help 로 AI 화면 참고만 매뉴얼 대표 절 요약으로 만든다.
// 같은 설명을 코드에 두 번 두지 않는다. help 가 없으면 화면 참고를 등록하지 않는다.
import { type ReactNode, useState } from 'react'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { useManualSummary } from '@/components/ai/screen-context/useManualSummary'
import {
  buildSettingsScreenContext,
  helpSummaryPairs,
  type SettingsAiContextInput,
} from '@/lib/aiScreenContext/builders/settings'

import { Page } from './Page'
import { SettingsScrollRootContext } from './settingsScrollRoot'

/** 매뉴얼 도움말로 옮긴 화면의 대표 도움말 id 와 화면 이름(WP-1507). */
export interface SettingsPageHelp {
  id: string
  name: string
}

type SettingsPageProps = {
  /** WP-1507: 매뉴얼 도움말 대표 절 id 와 화면 이름 — AI 화면 참고를 「설정 · <name>」 + 그 절 요약으로 만든다. 없으면 참고를 등록하지 않는다. */
  help?: SettingsPageHelp
  title: ReactNode
  /** 제목 앞 컨트롤(목록으로 돌아가기 등) — Page.Header icon 으로 넘겨 데스크톱에만 그린다. 모바일은 상세 헤더의 ‹ 가 대신한다. */
  icon?: ReactNode
  /** 제목 옆 보조 메타(프로젝트 키 등) — Page.Header meta 로 넘긴다. */
  meta?: ReactNode
  actions?: ReactNode
  width?: 'form' | 'full'
  /**
   * WP-414: 화면 핵심 값 — help 가 있는 화면의 AI 화면 맥락에 덧붙인다(대상은 focus, 상태 값은 facts).
   * 로드된 값만 넘기고, 비밀번호·토큰·시크릿은 넘기지 않는다.
   */
  aiContext?: SettingsAiContextInput | null
  'data-testid'?: string
  children: ReactNode
}

/**
 * 도움말 화면의 AI 화면 참고 등록(WP-1507) — help 를 준 화면에만 그려 AI·도움말 패널 상태 구독을 그 화면으로 한정한다.
 * 요약을 받기 전(패널이 다 닫힘·받는 중)에는 화면 이름과 화면 값만 싣는다. 그리는 것은 없다.
 */
function SettingsHelpScreenContext({ help, aiContext }: { help: SettingsPageHelp; aiContext?: SettingsAiContextInput | null }) {
  const summary = useManualSummary(help.id)
  useRegisterAiScreenContext(buildSettingsScreenContext(help.name, helpSummaryPairs(summary), aiContext))
  return null
}

export function SettingsPage({ title, icon, meta, actions, width = 'full', help, aiContext, children, ...rest }: SettingsPageProps) {
  // 본문 스크롤 요소 — 콜백 ref(useState)라 마운트 후 하위 무한 스크롤 sentinel 이 root 로 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  return (
    <Page width={width === 'form' ? 'settings' : 'full'} data-testid={rest['data-testid'] ?? 'settings-page'}>
      <Page.Header title={title} icon={icon} meta={meta} actions={actions} />
      <Page.Body
        scrollRef={setScrollEl}
        // 목록형은 배너·표 사이 간격(space-y-6)을 유지, 폼형은 섹션이 자체 여백·구분선을 가진다.
        className={width === 'full' ? 'space-y-6' : undefined}
      >
        <SettingsScrollRootContext.Provider value={scrollEl}>{children}</SettingsScrollRootContext.Provider>
      </Page.Body>
      {/* 본문 뒤에 둔다 — 첫 커밋에서 본문 안 등록보다 늦게 등록돼 예전(SettingsPage 가 등록)처럼 이 화면 맥락이 이긴다. */}
      {help && <SettingsHelpScreenContext help={help} aiContext={aiContext} />}
    </Page>
  )
}
