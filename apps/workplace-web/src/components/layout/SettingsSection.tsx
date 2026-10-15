// 설정 폼 주석 섹션 — 왼쪽 240px 제목·설명 / 오른쪽 입력. 본문 컨테이너(Page settings 폭의 @container)가 768px 미만이면 세로로 쌓는다.
// 왜: Polaris settings·Microsoft SettingsCard 처럼 넓은 폭을 입력창을 늘리지 않고 구조로 채워, 폼 화면도 다른 탭과 같은 폭 체계를 쓰게 한다(WP-397).
import { type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * 텍스트 입력 묶음(라벨+입력) 폭 상한 — 값 길이에 맞춘 폭(448px). `cn(..., settingsFieldClass)` 로 붙인다.
 * 왜: 이름처럼 짧은 값까지 입력 열 전체 폭으로 늘리면 넓은 화면에서 입력창이 과하게 길다. 설명·URL 처럼 긴 값에는 쓰지 않는다(WP-397).
 */
export const settingsFieldClass = 'max-w-md'

interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  /** danger: 위험 구역(삭제 등) — 제목을 파괴 색으로. */
  tone?: 'default' | 'danger'
  children?: ReactNode
  'data-testid'?: string
}

export function SettingsSection({
  title,
  description,
  tone = 'default',
  children,
  'data-testid': testId,
}: SettingsSectionProps) {
  const headingId = useId()
  return (
    <section
      data-slot="settings-section"
      data-testid={testId}
      // 영역 이름은 제목(h2) — 화면 낭독기가 섹션을 제목으로 찾는다.
      aria-labelledby={headingId}
      className="grid gap-x-12 gap-y-3 border-b py-6 first:pt-2 last:border-b-0 @min-[768px]:grid-cols-[240px_minmax(0,1fr)]"
    >
      <div data-slot="settings-section-heading" className="space-y-1">
        {/* 섹션 제목은 heading-group 위계(16px/24px semibold, 02-typography §2.1) — 본문 라벨(14px)과 구분되게. */}
        <h2 id={headingId} className={cn('text-base leading-6 font-semibold', tone === 'danger' && 'text-destructive')}>
          {title}
        </h2>
        {description != null && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {/* 안내만 하는 섹션(children 없음)은 입력 열을 만들지 않는다 — 빈 열이 세로로 쌓일 때 gap-y 만큼 여백이 더해진다.
          wrap-anywhere: 공백 없는 긴 값(이메일·아이디)도 끊어 min-content 폭을 줄인다 — 모바일 본문 가로 넘침 방지(WP-397 D2). */}
      {children != null && children !== false && (
        <div data-slot="settings-section-content" className="min-w-0 space-y-4 wrap-anywhere">
          {children}
        </div>
      )}
    </section>
  )
}

interface SettingsToggleRowProps {
  label: ReactNode
  description?: ReactNode
  /** 오른쪽 끝 컨트롤(보통 Switch). */
  control: ReactNode
  'data-testid'?: string
}

/**
 * 토글 행 — 제목·설명 왼쪽, 컨트롤 오른쪽 끝. 행 자체에는 세로 여백이 없다.
 * 왜: 단독 행 뒤에 안내 문단이 오면 행의 pb 가 섹션 간격(space-y-4)에 더해져 간격이 28px 로 벌어졌다(WP-397 D4).
 * 연속 행은 SettingsToggleGroup 으로 감싸 행 사이에만 여백·구분선을 둔다.
 */
export function SettingsToggleRow({ label, description, control, 'data-testid': testId }: SettingsToggleRowProps) {
  return (
    <div data-testid={testId} data-slot="settings-toggle-row" className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {description != null && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {/* 스위치(32×18px)는 겉크기는 그대로 두고 ::after 로 사방 12px 를 넓혀 터치 영역을 40px 이상으로(10-accessibility §I).
          가상 요소를 스위치(button) 자신에 붙여야 넓힌 영역의 탭이 스위치 클릭으로 전달된다 — 래퍼에 붙이면 클릭이 전달되지 않는다. */}
      <div className="flex shrink-0 items-center pt-0.5 [&>[data-slot=switch]]:relative [&>[data-slot=switch]]:after:absolute [&>[data-slot=switch]]:after:-inset-3 [&>[data-slot=switch]]:after:content-['']">
        {control}
      </div>
    </div>
  )
}

/** 연속 토글 행 묶음 — 행 사이에만 구분선(divide-y)과 위아래 12px 여백을 둔다(첫 행 위·마지막 행 아래는 0). */
export function SettingsToggleGroup({ children }: { children: ReactNode }) {
  return (
    <div data-slot="settings-toggle-group" className="divide-y [&>*:not(:first-child)]:pt-3 [&>*:not(:last-child)]:pb-3">
      {children}
    </div>
  )
}
