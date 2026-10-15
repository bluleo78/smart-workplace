// 설정 가이드 본문 — 열(aside)·데스크톱 시트·모바일 시트가 같은 마크업을 공유한다(WP-399).
// 제목 「설정 가이드」 는 감싸는 쪽(열 헤더·시트 제목)이 그리고, 여기선 소개 → 알아두기 → 주의 → 관련 화면 순으로만 그린다.
import { ChevronRight, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { SettingsGuide } from './types'

/** 소제목 + 내용 한 묶음(알아두기·주의·관련 화면). 소제목은 본문보다 한 단계 옅고 작게. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsGuidePanel({ guide, onNavigate }: { guide: SettingsGuide; onNavigate?: () => void }) {
  return (
    // break-keep: 좁은 열(280px)에서 한국어 단어가 음절 중간에서 끊기지 않게.
    <div className="space-y-5 break-keep">
      {/* 소개·알아두기는 보조 본문 토큰(body-secondary: text-sm leading-6) — 좁은 열에서 여러 줄로 감겨도 빽빽하지 않게. */}
      <p className="text-sm leading-6 text-muted-foreground">{guide.lead}</p>
      {guide.tips.length > 0 && (
        <Block title="알아두기">
          <ul className="list-disc space-y-1 pl-4 text-sm leading-6 marker:text-muted-foreground">
            {guide.tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </Block>
      )}
      {guide.caution && (
        <Block title="주의">
          {/* 되돌리기 어려운 동작 경고 — 경고 토큰(warning-subtle 면 + warning-text 글자)만 쓴다. */}
          <p className="flex gap-2 rounded-md bg-warning-subtle p-3 text-sm text-warning-text">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{guide.caution}</span>
          </p>
        </Block>
      )}
      {guide.related && guide.related.length > 0 && (
        <Block title="관련 화면">
          {/* 모바일은 링크마다 44px 터치 영역(min-h-11)이 간격을 대신하고, 데스크톱(lg)은 글자 높이 + 4px 간격. */}
          <ul className="text-sm lg:space-y-1">
            {guide.related.map((r) => (
              <li key={r.to}>
                {/* 시트 안이면 이동과 함께 시트를 닫는다(onNavigate). 「›」 는 다른 화면으로 간다는 단서. */}
                <Link
                  to={r.to}
                  onClick={onNavigate}
                  className="inline-flex min-h-11 items-center gap-1 text-primary underline-offset-4 hover:underline lg:min-h-0"
                >
                  {r.label}
                  <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  )
}
