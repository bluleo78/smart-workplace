// 설정 영역 공용 페이지 래퍼 — Page 위 얇은 래퍼.
// 폼형(width='form')은 Page settings 폭(주석 섹션), 목록형은 전체 폭. 헤더·본문이 Page 여백(px-4)을 공유해 시작선이 맞는다(WP-397).
// guide 가 있으면 화면별 설정 가이드를 붙인다(목록형은 단추 → 시트만, WP-1281) — 상태·요소는 useSettingsGuide 가 만들고 여기선 제자리에 꽂기만 한다(WP-399).
// help 가 있으면(가이드 글을 매뉴얼 도움말로 옮긴 화면, WP-1507) 가이드 칸·단추 없이 AI 화면 참고만 매뉴얼 대표 절 요약으로 만든다 —
// 설명은 도움말 패널(헤더 「도움말」)이 보이고, 같은 설명을 코드에 두 번 두지 않는다. guide 와 help 는 함께 줄 수 없다(타입으로 막는다).
import { type ReactNode, useState } from 'react'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { useManualSummary } from '@/components/ai/screen-context/useManualSummary'
import type { SettingsGuide } from '@/components/settings-guide/types'
import { useSettingsGuide } from '@/components/settings-guide/useSettingsGuide'
import {
  buildSettingsScreenContext,
  guidePairs,
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

/**
 * 화면 설명의 출처 — 설정 가이드(guide) 또는 매뉴얼 도움말 절(help) 가운데 하나, 또는 둘 다 없음.
 * - guide: 화면별 설정 가이드 — 폼형은 넓으면 오른쪽 열·좁으면 시트, 목록형은 옆에 남는 폭이 없어 머리 「가이드」 단추 → 시트로만 연다(WP-1281).
 * - help(WP-1507): AI 화면 참고를 「설정 · <name>」 + 그 절 요약으로 만든다.
 */
type SettingsPageSource = { guide?: SettingsGuide; help?: never } | { guide?: never; help?: SettingsPageHelp }

type SettingsPageProps = SettingsPageSource & {
  title: ReactNode
  /** 제목 앞 컨트롤(목록으로 돌아가기 등) — Page.Header icon 으로 넘겨 데스크톱에만 그린다. 모바일은 상세 헤더의 ‹ 가 대신한다. */
  icon?: ReactNode
  /** 제목 옆 보조 메타(프로젝트 키 등) — Page.Header meta 로 넘긴다. */
  meta?: ReactNode
  actions?: ReactNode
  width?: 'form' | 'full'
  /**
   * WP-414: 화면 핵심 값 — 가이드가 그려지는 화면의 AI 화면 맥락에 덧붙인다(대상은 focus, 상태 값은 facts).
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

export function SettingsPage({ title, icon, meta, actions, width = 'full', guide, help, aiContext, children, ...rest }: SettingsPageProps) {
  // 본문 스크롤 요소 — 콜백 ref(useState)라 마운트 후 하위 무한 스크롤 sentinel 이 root 로 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const guideUi = useSettingsGuide(guide, scrollEl, width === 'form')
  // WP-414: 가이드가 보이는 설정 화면은 AI 화면 맥락(설정 · 제목 + 가이드 요약 + 화면 값)을 등록한다 — 「AI 에게 묻기」가 이 맥락으로 묻는다.
  // WP-1507: help 를 준 화면은 아래 SettingsHelpScreenContext 가 매뉴얼 대표 절 요약으로 같은 꼴의 맥락을 등록한다.
  useRegisterAiScreenContext(guide ? buildSettingsScreenContext(guide.title, guidePairs(guide), aiContext) : null)
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
      {/* 본문 뒤에 둔다 — 첫 커밋에서 본문 안 등록보다 늦게 등록돼 예전(SettingsPage 가 등록)처럼 이 화면 맥락이 이긴다. */}
      {help && <SettingsHelpScreenContext help={help} aiContext={aiContext} />}
    </Page>
  )
}
