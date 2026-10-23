// 평문 안의 URL 을 새 탭 링크로 그리는 공용 컴포넌트 — 채팅 본문(WP-874)·캘린더 일정 설명이 같이 쓴다.
// 어떤 문자열을 링크로 볼지는 규칙 묶음(lib/textLinks 의 CHAT_LINK_RULES·CALENDAR_LINK_RULES)이 정한다.
import { type MouseEvent, type ReactNode, useMemo } from 'react'

import { CHAT_LINK_RULES, type LinkRules, splitLinks } from '@/lib/textLinks'

/** 본문 링크 기본 모양 — 밑줄, 공백 없는 긴 URL 도 줄바꿈. */
const LINK_CLASS = 'text-primary underline underline-offset-2 break-all'

/**
 * 새 탭 링크(noopener). click 은 위로 올려 보내지 않는다(채팅 행 클릭·탭 툴바 노출과 겹치지 않게).
 * 채팅 목록의 길게 누르기 뒤 click 은 목록이 캡처 단계에서 먼저 삼키므로(useMessageListLongPress) 여기 stopPropagation 과 충돌하지 않는다.
 */
export function TextLink({
  href,
  children,
  className = LINK_CLASS,
  testId,
}: {
  href: string
  children: ReactNode
  /** 주면 기본 모양을 통째로 바꾼다. */
  className?: string
  testId?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      className={className}
    >
      {children}
    </a>
  )
}

/** 평문 한 조각 — URL 만 링크로 바꾸고 나머지(줄바꿈 포함)는 그대로 둔다. 기본 규칙은 채팅. */
export function LinkedText({ text, rules = CHAT_LINK_RULES, linkTestId }: { text: string; rules?: LinkRules; linkTestId?: string }) {
  const segments = useMemo(() => splitLinks(text, rules), [text, rules])
  return (
    <>
      {segments.map((s, i) =>
        s.type === 'text' ? (
          s.text
        ) : (
          <TextLink key={i} href={s.href} testId={linkTestId}>
            {s.text}
          </TextLink>
        ),
      )}
    </>
  )
}
