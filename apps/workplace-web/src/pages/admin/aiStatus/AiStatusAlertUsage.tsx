// AI 현황 개요의 경고 자리(WP-1824·WP-2031) — 서버 경고 목록(위험·주의)을 12열 전체 폭으로 그린다.
// 사용률 패널(동시 처리·계정 5시간 막대)은 지표 카드·작은 그래프·계정 화면과 겹쳐 뺐다.
// 계정 사용률 경고는 알림 모델 alertRows 가 한 줄로 묶어 준다(계정 수만큼 줄이 늘지 않게).
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import type { AiStatusAlert, AiStatusPeriod } from '@/api/aiStatus'
import { AlertList } from '@/components/metrics/AlertList'
import { Button } from '@/components/ui/button'

import { alertRows } from './aiStatusModel'

/**
 * 경고 자리 — 경고마다 「이력 보기」(그 조건의 처리 이력)·「계정 보기」(AI 계정 관리) 링크를 붙인다.
 * 줄 구성과 이동 주소는 모델 alertRows 가 정한다.
 */
export function AiStatusAlertUsage({
  alerts,
  period,
}: {
  alerts: AiStatusAlert[]
  /** 지금 화면 데이터의 기간 — 이력 주소에 함께 넘긴다. */
  period: AiStatusPeriod
}) {
  // 응답·기간이 바뀔 때만 줄을 다시 만든다
  const items = useMemo(
    () =>
      alertRows(alerts, period).map(({ item, target }) => {
        if (target == null) return item
        return {
          ...item,
          action: (
            <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
              <Link to={target.href}>{target.label}</Link>
            </Button>
          ),
        }
      }),
    [alerts, period],
  )
  return (
    <section className="space-y-2" data-testid="ai-status-alert-usage">
      <h2 className="text-sm font-semibold">경고</h2>
      <AlertList items={items} />
    </section>
  )
}
