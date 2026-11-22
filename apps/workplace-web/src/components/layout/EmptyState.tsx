/**
 * 빈 상태 공용 부품(WP-1947) — 아이콘·제목·설명·액션 4요소를 06 §B 규격 상수로 그린다.
 * 화면마다 같은 마크업을 손으로 쓰다 규격(크기·색·태그)이 갈라지던 것을 한 곳으로 모은다.
 * 목록·위젯·모바일 부품이 이것을 감싸며, 옮기기 전과 같은 DOM(태그·클래스·testid·role)을 내도록 props 로 조절한다.
 */
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  emptyStateDescriptionClass,
  emptyStateIconClass,
  emptyStatePositiveIconClass,
  emptyStateTitleClass,
  mobileEmptyStateDescriptionClass,
  mobileEmptyStateIconClass,
  mobileEmptyStatePositiveIconClass,
  mobileEmptyStateTitleClass,
} from '@/components/layout/empty-state'
import { cn } from '@/lib/utils'

// WP-1947: 상수 파일(empty-state.ts)과 부품 파일(EmptyState.tsx)의 이름이 대소문자·하이픈만 달라 자동 import 가 헷갈리므로,
// 부품 모듈에서도 같은 상수를 다시 내보낸다. 원본은 여전히 empty-state.ts 한 곳이다(기존 import 는 그대로 둔다).
// 상수 재내보내기는 컴포넌트 export 가 아니라 fast-refresh 규칙 대상이 아닌 순수 문자열이므로 규칙을 이 블록에서만 끈다.
/* eslint-disable react-refresh/only-export-components */
export {
  emptyStateDescriptionClass,
  emptyStateIconClass,
  emptyStatePositiveIconClass,
  emptyStateTitleClass,
  mobileEmptyStateDescriptionClass,
  mobileEmptyStateIconClass,
  mobileEmptyStatePositiveIconClass,
  mobileEmptyStateTitleClass,
} from '@/components/layout/empty-state'
/* eslint-enable react-refresh/only-export-components */

/** EmptyState props — 바깥 레이아웃(gap·padding·정렬)은 className 으로 받고, 4요소 규격만 부품이 정한다. */
export interface EmptyStateProps {
  /** 아이콘. 없으면 그리지 않는다. 늘 aria-hidden. */
  icon?: LucideIcon
  /** 제목(필수). */
  title: ReactNode
  /** 설명. null·undefined 면 그리지 않는다. */
  description?: ReactNode
  /** 그대로 끝에 붙인다(감싸는 div 는 호출부가). */
  action?: ReactNode
  /** 기본 desktop — 아이콘·제목·설명 상수 세트 선택. */
  size?: 'desktop' | 'mobile'
  /** 기본 default — positive 는 아이콘만 primary 색(데스크톱·모바일 모두, 크기는 size 규격 그대로). */
  tone?: 'default' | 'positive'
  /** 아이콘 앞에 그대로 붙일 노드(예: sr-only 헤딩). 아이콘이 없어도 맨 앞에 그린다. */
  leading?: ReactNode
  /**
   * 레이아웃 변형 — 'widget' 은 홈 위젯 빈 상태 공통 모양(gap-2 px-4 py-8 + 설명 max-w-xs)을 깐다.
   * 위젯 16곳이 같은 className 쌍을 반복하던 것을 모은다(WP-1947). className·descriptionClassName 은 그 뒤에 덧붙는다.
   */
  variant?: 'widget'
  /** 참이면 제목·설명을 space-y-1 div(role=textRole)로 묶는다. action 은 묶음 밖. textRole 이 있으면 자동으로 묶는다. */
  grouped?: boolean
  /** 묶음 div 의 role — 지정하면 grouped 없이도 묶음 div 가 생긴다(role 을 붙일 요소가 필요하므로). */
  textRole?: 'status'
  /** 묶음 div 에 덧붙일 클래스 — 묶음이 있을 때만 쓰인다. */
  textClassName?: string
  /** 제목 태그. 기본 'p'. */
  titleAs?: 'p' | 'div'
  /** 제목에 덧붙일 클래스(자리별 max-w·break 등). */
  titleClassName?: string
  /** 설명 태그. 기본 'p'(위젯 빈 상태처럼 div 였던 자리를 위해 고를 수 있다). */
  descriptionAs?: 'p' | 'div'
  /** 설명에 덧붙일 클래스. */
  descriptionClassName?: string
  /** 바깥 div: cn('flex flex-col items-center text-center', className). */
  className?: string
  /** 바깥 data-testid. */
  testId?: string
}

/** 빈 상태 4요소(아이콘·제목·설명·액션)를 size·tone 에 맞는 규격 상수로 그린다. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  leading,
  variant,
  size = 'desktop',
  tone = 'default',
  grouped = false,
  textRole,
  textClassName,
  titleAs = 'p',
  titleClassName,
  descriptionAs = 'p',
  descriptionClassName,
  className,
  testId,
}: EmptyStateProps) {
  const mobile = size === 'mobile'
  // positive 는 크기 규격(size)과 색(tone)을 따로 고른다 — 모바일도 positive 면 primary 색(WP-1947, 예전엔 조용히 muted).
  const iconClass = mobile
    ? tone === 'positive'
      ? mobileEmptyStatePositiveIconClass
      : mobileEmptyStateIconClass
    : tone === 'positive'
      ? emptyStatePositiveIconClass
      : emptyStateIconClass
  const widget = variant === 'widget'
  // textRole 은 묶음 div 에만 붙일 수 있으므로 textRole 이 있으면 grouped 와 같게 묶는다(WP-1947).
  const wrapped = grouped || textRole != null
  const TitleTag = titleAs
  const titleEl = (
    <TitleTag className={cn(mobile ? mobileEmptyStateTitleClass : emptyStateTitleClass, titleClassName)}>{title}</TitleTag>
  )
  const DescriptionTag = descriptionAs
  const descriptionEl =
    description != null ? (
      <DescriptionTag
        className={cn(mobile ? mobileEmptyStateDescriptionClass : emptyStateDescriptionClass, widget && 'max-w-xs', descriptionClassName)}
      >
        {description}
      </DescriptionTag>
    ) : null
  // 제목·설명 한 쌍 — grouped 면 묶음 div 안에, 아니면 바깥에 바로 둔다.
  const body = (
    <>
      {titleEl}
      {descriptionEl}
    </>
  )

  return (
    <div
      className={cn('flex flex-col items-center text-center', widget && 'gap-2 px-4 py-8', className)}
      data-testid={testId}
    >
      {leading}
      {Icon && <Icon className={iconClass} aria-hidden="true" />}
      {wrapped ? (
        <div className={cn('space-y-1', textClassName)} role={textRole}>
          {body}
        </div>
      ) : (
        body
      )}
      {action}
    </div>
  )
}
