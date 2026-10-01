// 모바일 위젯 표시 정의(WP-142) — 위젯 종류는 하나로 두고, 좁은 화면에서 어떻게 보일지만 레지스트리에 덧붙인다.
import type { ComponentType, ReactNode } from 'react'

/** 요약 한 줄 상태 — Summary 컴포넌트가 자기 쿼리 결과로 채워 render 에 넘긴다. */
export interface MobileSummaryData {
  status: 'loading' | 'error' | 'ready'
  /** 머리 건수 배지(0·미지정이면 배지 생략). */
  count?: number
  /** count 가 한 페이지 상한일 뿐 더 있음 — 배지를 "N+" 로 표시한다. */
  countMore?: boolean
  /** 본문 앞 고정 조각(이슈 키·시각·사분면 칩) — 줄어들지 않는다. */
  prefix?: ReactNode
  /** 요약 본문 — 넘치면 말줄임. */
  text?: ReactNode
  /** 본문 뒤 고정 조각(D-n·안 읽음 수) — 줄어들지 않는다. */
  meta?: ReactNode
  /** 타일 이동 경로 덮어쓰기 — 위젯 deepLink 가 없는 AI 우선순위가 최상위 항목으로 보낼 때. */
  to?: string
}

/**
 * Summary 컴포넌트 props. 머리 건수 배지와 아래 한 줄이 같은 데이터를 쓰므로, 데이터는 Summary 가 훅으로 얻고
 * 모양(머리·한 줄·링크 틀)은 카드가 render 로 그린다.
 */
export interface MobileSummaryProps {
  params?: Record<string, unknown> | null
  render: (data: MobileSummaryData) => ReactNode
}

/** 위젯별 모바일 표시 정의. */
export interface MobileWidgetDef {
  /** true = 본문형(⌃/⌄ 접기 가능), false = 타일형(항상 한 줄, 누르면 앱 이동). */
  body: boolean
  /** 접힌 상태·타일의 "요약 한 줄 + 건수". 위젯 본문이 이미 쓰는 쿼리 훅을 같은 인자로 재사용(새 API 없음). */
  Summary: ComponentType<MobileSummaryProps>
}
