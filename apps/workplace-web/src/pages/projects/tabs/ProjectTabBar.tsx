// 프로젝트 탭 줄(WP-1477) — 개요·이슈·타임라인·사이클·버전. 모양은 components/ui/tabs 의 line 변형(밑줄)과 같게 하되
// 탭을 링크(<Link>)로 그려 새 창 열기·주소 복사가 되게 한다. 좁은 폭에서는 줄바꿈 없이 가로 스크롤(스크롤바 숨김).
import { Link } from 'react-router-dom'

import { pageGutterClass } from '@/components/layout/Page'
import { cn } from '@/lib/utils'

import { PROJECT_TABS, type ProjectTabId, projectTabPath } from './projectTabs'

/**
 * 탭 하나의 모양 — line 변형 탭(TabsTrigger)처럼 옅은 글자 + 고른 탭만 진한 글자·아래 2px 밑줄.
 * 고른 탭은 aria-current="page" 로 표시하고 그 속성으로 모양을 건다. 밑줄은 탭 줄의 아래 경계선(border-b) 위에 겹친다(bottom-[-1px]).
 */
const tabClass = cn(
  'relative inline-flex h-10 shrink-0 items-center px-3 text-sm font-medium whitespace-nowrap transition-colors',
  'text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground',
  'after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-foreground after:opacity-0 aria-[current=page]:after:opacity-100',
  'rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
)

/**
 * 보이는 탭만 링크로 늘어놓는다.
 * - 접근성: 탭은 페이지 이동 링크라 ARIA 탭 패턴(tablist·tab·aria-selected)을 쓰지 않는다 — 그 패턴은 tabpanel·화살표 키 이동을
 *   약속하는데 여기엔 없다. 대신 nav(「프로젝트 탭」) 안 링크 + 지금 탭에 aria-current="page".
 * - 기록: 탭 클릭은 replace 로 옮긴다 — 탭 사이 이동이 방문 기록에 쌓이면 모바일 ‹·브라우저 뒤로가 탭을 하나씩 거슬러 간다
 *   (routes.ts PROJECT_TAB: ‹ 는 프로젝트 화면을 떠난다). REPLACE 는 「마지막 탭으로 되돌리기」(PUSH·첫 진입만) 대상이 아니다.
 * - 이슈 탭 링크는 state.projectTab 을 실어 되돌리기를 한 번 더 막는다(이슈 탭을 눌렀는데 기억한 다른 탭으로 튕기지 않게).
 */
export function ProjectTabBar({ projectKey, active }: { projectKey: string; active: ProjectTabId | null }) {
  return (
    // 스크롤바 숨김은 !important(`…!`)로 건다 — index.css 의 전역 `* { scrollbar-width: thin }` 은 레이어 밖 규칙이라
    // @layer utilities 의 보통 유틸리티를 이겨, 그냥 [scrollbar-width:none] 이면 320px 에서 탭 밑에 얇은 스크롤바가 남는다.
    <nav
      aria-label="프로젝트 탭"
      className={cn('shrink-0 overflow-x-auto border-b whitespace-nowrap [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden', pageGutterClass)}
    >
      <div className="flex w-max items-center gap-1">
        {PROJECT_TABS.filter((t) => t.visible).map((t) => (
          <Link
            key={t.id}
            aria-current={active === t.id ? 'page' : undefined}
            data-testid={`project-tab-${t.id}`}
            to={projectTabPath(projectKey, t.id)}
            replace
            state={t.id === 'issues' ? { projectTab: true } : undefined}
            className={tabClass}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
