// 설정 가이드 본문 — 열(aside)·데스크톱 시트·모바일 시트가 같은 마크업을 공유한다(WP-399).
// 제목 「설정 가이드」 는 감싸는 쪽(열 헤더·시트 제목)이 그리고, 여기선 소개 → 알아두기 → 주의 → 관련 화면 → AI 에게 묻기 순으로만 그린다.
import { ChevronRight, Sparkles, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { useAiAvailable } from '@/hooks/useAiAvailable'

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

/** WP-414: AI 입력창에 미리 채울 문구 — 끝 공백은 사용자가 바로 이어 쓰게 둔 것. */
const ASK_AI_PROMPT = '이 설정에 대해 알려줘 '

/**
 * WP-414: 「이 설정에 대해 AI에게 묻기」 — 입력창을 채운 채 AI 를 연다(데스크톱 옆 패널, 모바일은 전체화면).
 * 화면 맥락(설정 · 제목 + 가이드 요약 + 화면 값)은 SettingsPage 가 등록해 두므로 여기선 열기만 한다. AI 를 못 쓰면 숨긴다.
 */
function AskAiButton({ onAsk }: { onAsk?: () => void }) {
  const { askWithPrompt } = useAssistant()
  const aiAvailable = useAiAvailable()
  if (!aiAvailable) return null
  return (
    <button
      type="button"
      data-testid="settings-guide-ask-ai"
      onClick={() => {
        askWithPrompt(ASK_AI_PROMPT)
        // 시트 안이면 닫는다 — AI 패널(모바일은 전체화면)이 주인공이 되게.
        onAsk?.()
      }}
      // 모바일 44px 터치 영역(min-h-11), 데스크톱(lg)은 36px. 색은 AI 표식 토큰(ai-accent)만 쓴다.
      // ring-inset: 열(aside)이 overflow-y-auto 라 바깥 링은 왼쪽 가장자리에서 잘린다(WP-414) — 안쪽에 그린다.
      className="flex min-h-11 w-full items-center gap-2 rounded-md border border-ai-accent/30 bg-ai-accent-subtle px-3 text-left text-sm font-medium text-ai-accent outline-none hover:bg-ai-accent/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset lg:min-h-9"
    >
      <Sparkles aria-hidden className="size-4 shrink-0" />
      이 설정에 대해 AI에게 묻기
    </button>
  )
}

export function SettingsGuidePanel({
  guide,
  onNavigate,
}: {
  guide: SettingsGuide
  /** 관련 화면 링크로 이동하거나 AI 에게 물을 때(시트면 닫기). */
  onNavigate?: () => void
}) {
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
      <AskAiButton onAsk={onNavigate} />
    </div>
  )
}
