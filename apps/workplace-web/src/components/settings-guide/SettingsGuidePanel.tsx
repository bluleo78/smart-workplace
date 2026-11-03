// 설정 가이드 본문 — 열(aside)·데스크톱 시트·모바일 시트가 같은 마크업을 공유한다(WP-399).
// 제목 「설정 가이드」 는 감싸는 쪽(열 헤더·시트 제목)이 그리고, 여기선 소개 → (할 일 순서) → 알아두기 → 주의 → 관련 화면 → AI 에게 묻기 순으로만 그린다.
import { ChevronDown, ChevronRight, Sparkles, TriangleAlert } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { CopyableCommand } from '@/components/CopyableCommand'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { copyText } from '@/lib/copyText'
import { cn, objectParticle } from '@/lib/utils'

import type { SettingsGuide, SettingsGuideSection, SettingsGuideStep } from './types'

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

/** 값 복사 단추 — 실패하면 직접 선택하도록 알린다. */
async function copyValue(label: string, value: string) {
  const what = label.replace(/ 복사$/, '')
  if (await copyText(value)) toast.success(`${what}${objectParticle(what)} 복사했습니다`)
  else toast.error('복사에 실패했습니다. 직접 선택해 복사하세요.')
}

/** 할 일 한 단계의 내용 — 지시 → 값 복사 → 명령(복사 단추 포함). */
function StepBody({ step }: { step: SettingsGuideStep }) {
  return (
    <div className="min-w-0 space-y-2">
      {step.body && <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>}
      {step.copyValue && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={step.copyValue.testId}
          onClick={() => void copyValue(step.copyValue!.label, step.copyValue!.value)}
        >
          {step.copyValue.label}
        </Button>
      )}
      {step.commands?.map((c, i) => (
        <div key={c.testId ?? i} className="min-w-0 space-y-1">
          {c.label && <p className="text-xs text-muted-foreground">{c.label}</p>}
          <CopyableCommand command={c.command} testId={c.testId ?? `settings-guide-step-command-${i}`} />
        </div>
      ))}
    </div>
  )
}

/** 할 일 순서 — 단계마다 제목 + 내용. 접힌 단계(「다른 방법」)는 눌러 펼친다. */
function Steps({ steps }: { steps: SettingsGuideStep[] }) {
  return (
    <ol className="space-y-4" data-testid="settings-guide-steps">
      {steps.map((step) =>
        step.collapsed ? (
          <li key={step.title}>
            <Collapsible className="border-t pt-3">
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground">
                {step.title}
                <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <StepBody step={step} />
              </CollapsibleContent>
            </Collapsible>
          </li>
        ) : (
          <li key={step.title} className="space-y-2">
            <h4 className="text-sm font-medium">{step.title}</h4>
            <StepBody step={step} />
          </li>
        ),
      )}
    </ol>
  )
}

/** 알아두기 목록 — 최상위·섹션이 같은 모양을 쓴다. */
function TipList({ tips }: { tips: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4 text-sm leading-6 marker:text-muted-foreground">
      {tips.map((tip) => <li key={tip}>{tip}</li>)}
    </ul>
  )
}

/** 주의 상자 — 되돌리기 어려운 동작 경고. 경고 토큰(warning-subtle 면 + warning-text 글자)만 쓴다. */
function Caution({ text }: { text: string }) {
  return (
    <p className="flex gap-2 rounded-md bg-warning-subtle p-3 text-sm text-warning-text">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

/**
 * 화면 섹션 하나의 도움말(WP-1281) — 제목은 화면 섹션 제목과 같다. 지금 보고 있는 섹션이면 왼쪽 테두리로 은은하게 강조한다.
 * data-guide-section 으로 따라가기 대상을 찾는다.
 */
function GuideSection({ section, active }: { section: SettingsGuideSection; active: boolean }) {
  return (
    <section
      data-guide-section={section.id}
      data-active={active || undefined}
      className={cn('space-y-2 border-l-2 pl-3 transition-colors', active ? 'border-primary' : 'border-transparent')}
    >
      <h3 className={cn('text-sm font-semibold', !active && 'text-muted-foreground')}>{section.title}</h3>
      {section.steps && section.steps.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{section.stepsTitle ?? '할 일 순서'}</h4>
          <Steps steps={section.steps} />
        </div>
      )}
      {section.tips && section.tips.length > 0 && <TipList tips={section.tips} />}
      {section.caution && <Caution text={section.caution} />}
    </section>
  )
}

/** 스크롤되는 가장 가까운 조상 — 열(aside)·시트 본문 칸. 페이지 전체가 움직이지 않게 이 요소만 스크롤한다. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

/** 사용자가 가이드를 직접 움직인 뒤 이 시간 동안은 끌어당기지 않는다. */
const USER_SCROLL_HOLD_MS = 1000

/**
 * 지금 섹션 따라가기(WP-1281) — activeSection 이 바뀌면 가이드 스크롤 칸을 그 섹션 머리로 옮긴다.
 * 처음(열이 생기거나 시트를 연 직후)은 바로, 그 뒤는 부드럽게(움직임 줄이기 설정이면 바로). 사용자가 최근 1초 안에 가이드를 휠·터치·키로 움직였으면 두지 않는다.
 */
function useFollowSection(rootRef: RefObject<HTMLDivElement | null>, activeSection: string | null | undefined) {
  const lastUserAt = useRef(0)
  const first = useRef(true)
  useEffect(() => {
    const container = scrollParent(rootRef.current)
    if (!container) return
    const mark = () => {
      lastUserAt.current = Date.now()
    }
    const events = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const
    for (const e of events) container.addEventListener(e, mark, { passive: true })
    return () => {
      for (const e of events) container.removeEventListener(e, mark)
    }
  }, [rootRef])
  useEffect(() => {
    if (!activeSection) return
    const root = rootRef.current
    const container = scrollParent(root)
    const target = root?.querySelector<HTMLElement>(`[data-guide-section="${CSS.escape(activeSection)}"]`)
    if (!container || !target) return
    if (Date.now() - lastUserAt.current < USER_SCROLL_HOLD_MS) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const behavior: ScrollBehavior = first.current || reduce ? 'auto' : 'smooth'
    first.current = false
    const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 8
    container.scrollTo({ top: Math.max(0, top), behavior })
  }, [rootRef, activeSection])
}

export function SettingsGuidePanel({
  guide,
  activeSection,
  onNavigate,
}: {
  guide: SettingsGuide
  /** 본문에서 지금 보고 있는 섹션 id(WP-1281) — 섹션별 가이드면 그 섹션을 강조하고 따라간다. */
  activeSection?: string | null
  /** 관련 화면 링크로 이동하거나 AI 에게 물을 때(시트면 닫기). */
  onNavigate?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useFollowSection(rootRef, guide.sections ? activeSection : null)
  return (
    // break-keep: 좁은 열(280px)에서 한국어 단어가 음절 중간에서 끊기지 않게.
    <div ref={rootRef} className="space-y-5 break-keep">
      {/* 소개·알아두기는 보조 본문 토큰(body-secondary: text-sm leading-6) — 좁은 열에서 여러 줄로 감겨도 빽빽하지 않게. */}
      <p className="text-sm leading-6 text-muted-foreground">{guide.lead}</p>
      {guide.tips && guide.tips.length > 0 && (
        <Block title="알아두기">
          <TipList tips={guide.tips} />
        </Block>
      )}
      {/* 섹션별 가이드(WP-1281) — 화면 섹션 순서대로. 지금 섹션(activeSection, 아직 모르면 첫 섹션)을 강조한다.
          지금 화면 섹션에 도움말이 없으면(가이드에 없는 id·빈 id, WP-1298) 아무 섹션도 강조하지 않는다 — null(아직 모름)과 구분한다. */}
      {guide.sections?.map((sec, i) => (
        <GuideSection key={sec.id} section={sec} active={activeSection != null ? activeSection === sec.id : i === 0} />
      ))}
      {guide.caution && (
        <Block title="주의">
          <Caution text={guide.caution} />
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
