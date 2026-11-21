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
  mobileEmptyStateTitleClass,
} from '@/components/layout/empty-state'
import { cn } from '@/lib/utils'

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
  /** 기본 default — positive 는 데스크톱 아이콘만 emptyStatePositiveIconClass. */
  tone?: 'default' | 'positive'
  /** 참이면 제목·설명을 space-y-1 div(role=textRole)로 묶는다. action 은 묶음 밖. */
  grouped?: boolean
  /** 묶음 div 의 role — grouped 일 때만 쓰인다(묶지 않으면 붙일 요소가 없어 무시된다). */
  textRole?: 'status'
  /** 묶음 div 에 덧붙일 클래스 — grouped 일 때만 쓰인다. */
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
  const iconClass = mobile
    ? mobileEmptyStateIconClass
    : tone === 'positive'
      ? emptyStatePositiveIconClass
      : emptyStateIconClass
  const TitleTag = titleAs
  const titleEl = (
    <TitleTag className={cn(mobile ? mobileEmptyStateTitleClass : emptyStateTitleClass, titleClassName)}>{title}</TitleTag>
  )
  const DescriptionTag = descriptionAs
  const descriptionEl =
    description != null ? (
      <DescriptionTag
        className={cn(mobile ? mobileEmptyStateDescriptionClass : emptyStateDescriptionClass, descriptionClassName)}
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
    <div className={cn('flex flex-col items-center text-center', className)} data-testid={testId}>
      {Icon && <Icon className={iconClass} aria-hidden="true" />}
      {grouped ? (
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
