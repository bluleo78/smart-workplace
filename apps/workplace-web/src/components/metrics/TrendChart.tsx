/**
 * TrendChart 껍데기 (WP-1822). Recharts 는 impl 로 미뤄 lazy 로 불러 메인·개요 청크에 섞이지 않게 한다(makeLazyChart).
 */
import type { ReactElement } from 'react'

import type { BaseChartProps } from './chartTypes'
import { makeLazyChart } from './lazyChart'

/** 제네릭 시그니처로 내보내 호출자가 데이터 타입에 맞춘 xKey 검사를 받게 한다 */
export const TrendChart = makeLazyChart<BaseChartProps<unknown>>(() => import('./TrendChart.impl')) as unknown as <D>(
  props: BaseChartProps<D>,
) => ReactElement
