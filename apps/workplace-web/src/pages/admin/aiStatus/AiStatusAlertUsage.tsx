// AI 현황 개요의 경고·사용률 자리(WP-1824) — 왼쪽은 서버 경고 목록(위험·주의), 오른쪽은 작업 칸·AI 계정 사용률 막대.
// 12열 그리드에서 경고 8 / 사용률 4 로 나뉘고 모바일에서는 위아래로 쌓인다(설계 §5-3 3).
// 막대 색은 공용 usageBarTone 이 판정하고, 값이 없는 자리(최근 표본 없음)는 막대를 그리지 않고 「—」 만 남긴다(0 이 아니다).
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import type { AiStatusAlert, AiStatusPeriod, Usage } from '@/api/aiStatus'
import { AlertList } from '@/components/metrics/AlertList'
import { UsageMeter } from '@/components/metrics/UsageMeter'
import { Button } from '@/components/ui/button'
import { formatUsedPercent, usageBarTone } from '@/lib/agentAccountUsage'
import { EMPTY_GLYPH, formatLocalClockTime24 } from '@/lib/formatters'

import { alertItem, alertTarget, slotUsageText } from './aiStatusModel'

/** 작업 칸 사용 — 사용·한도가 둘 다 있을 때만 막대를 그린다(한도가 없으면 비율을 쓰지 않는다).
 * 글자는 지표 카드와 같은 slotUsageText 로 쓴다(한 화면에서 같은 값이 다르게 읽히지 않게). */
function SlotUsage({ usage }: { usage: Usage }) {
  const { slotUsed, slotLimit } = usage
  const percent = slotUsed != null && slotLimit != null && slotLimit > 0 ? (slotUsed / slotLimit) * 100 : null
  const text = slotUsageText(slotUsed, slotLimit)
  return (
    <div className="space-y-1" data-testid="usage-slot">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">작업 칸</h3>
        <p className="text-sm tabular-nums">{text}</p>
      </div>
      {percent != null && (
        <UsageMeter percent={percent} tone={usageBarTone({ usedPercent: percent, resetsAt: null })} label="작업 칸 사용률" />
      )}
    </div>
  )
}

/** AI 계정 5시간 한도 — 계정마다 이름·현재 %(없으면 —)·막대·초기화 시각. 5시간 값이 없으면 막대 자리도 비운다. */
function AccountUsage({ account }: { account: Usage['accounts'][number] }) {
  return (
    <div className="space-y-1" data-testid={`usage-account-${account.accountId}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">{account.label}</p>
        <p className="text-sm tabular-nums">
          {account.usedPercent5h == null ? EMPTY_GLYPH : formatUsedPercent(account.usedPercent5h)}
        </p>
      </div>
      {account.usedPercent5h != null && (
        <UsageMeter
          percent={account.usedPercent5h}
          tone={usageBarTone({ usedPercent: account.usedPercent5h, resetsAt: account.resetsAt5h })}
          label={`${account.label} 5시간 사용률`}
        />
      )}
      {account.resetsAt5h && <p className="text-xs text-muted-foreground">{formatLocalClockTime24(account.resetsAt5h)} 초기화</p>}
    </div>
  )
}

/** 경고·사용률 자리 — 경고 8 / 사용률 4, 모바일(12열 아래)은 세로로 쌓는다.
 * 경고마다 「이력 보기」(그 조건의 처리 이력)·「계정 보기」(AI 계정 관리) 링크를 붙인다 — 주소는 모델 alertTarget 이 정한다. */
export function AiStatusAlertUsage({
  alerts,
  usage,
  period,
}: {
  alerts: AiStatusAlert[]
  usage: Usage
  /** 지금 화면 데이터의 기간 — 이력 주소에 함께 넘긴다. */
  period: AiStatusPeriod
}) {
  // 경고 한 줄마다 항목과 이동을 함께 만든다 — 응답·기간이 바뀔 때만 다시 만든다
  const items = useMemo(
    () =>
      alerts.map((alert, i) => {
        const item = alertItem(alert, i)
        const target = alertTarget(alert, period)
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
    <div className="grid grid-cols-12 gap-4" data-testid="ai-status-alert-usage">
      <section className="col-span-12 space-y-2 lg:col-span-8">
        <h2 className="text-sm font-semibold">경고</h2>
        <AlertList items={items} />
      </section>
      <section className="col-span-12 space-y-3 lg:col-span-4">
        <h2 className="text-sm font-semibold">사용률</h2>
        <SlotUsage usage={usage} />
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground">AI 계정 5시간 한도</h3>
          {usage.accounts.length === 0 && <p className="text-sm text-muted-foreground">연결된 AI 계정 없음</p>}
          {usage.accounts.map((account) => (
            <AccountUsage key={account.accountId} account={account} />
          ))}
        </div>
      </section>
    </div>
  )
}