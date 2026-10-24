// src/components/settings/NotificationSettingsMatrix.tsx
// 설정 › 알림 「알림 종류」 매트릭스(WP-913) — 앱별 카드 안에 항목 줄 × 「사람이 / AI가」 두 열 스위치.
// 왜: 같은 알림이라도 사람이 했을 때와 AI 가 했을 때 받고 싶은 정도가 달라(AI 작업 중 코멘트·상태 변경 알림 폭주), 칸마다 따로 끈다.
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { BusySwitch } from '@/components/BusySwitch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { APP_LABEL, APP_NOTE, cellView, ITEM_META, knownApps } from '@/lib/notificationSettingsMeta'
import { cn } from '@/lib/utils'
import type {
  NotificationActor,
  NotificationApp,
  NotificationAppSetting,
  NotificationItemSetting,
  NotificationSettingItem,
  NotificationSettings,
} from '@/types/notificationSettings'

interface NotificationSettingsMatrixProps {
  settings: NotificationSettings
  /** 저장 요청 진행 중 — 모든 스위치를 busy 로 잠근다(초점은 유지, WP-847). */
  saving: boolean
  /** 좁은 화면(모바일) 배치 — 열 머리 「사람·AI」, 좁은 열, 설명 숨김, 카드 접기/펼치기(처음엔 이슈만 펼침). */
  compact: boolean
  onAppChange: (app: NotificationApp, enabled: boolean) => void
  onCellChange: (item: NotificationSettingItem, actor: NotificationActor, enabled: boolean) => void
}

// 항목 | 사람이 | AI가 — 스위치 열은 고정 폭(데스크톱 64px·모바일 40px, 시안), 항목 열은 남는 폭(min 0)이라 좁은 화면에서도 가로로 넘치지 않는다.
const ROW_GRID = 'grid items-center gap-x-2 px-4'
const gridCols = (compact: boolean) => (compact ? 'grid-cols-[minmax(0,1fr)_2.5rem_2.5rem]' : 'grid-cols-[minmax(0,1fr)_4rem_4rem]')

// 스위치(32×18px)는 겉크기는 두고 ::after 로 터치 영역을 넓힌다(10-accessibility §I, SettingsToggleRow 와 같은 방식).
// 데스크톱: 56×40px — 세로는 줄 높이(40px)만큼만 넓혀 위아래 줄과 겹치지 않게 한다.
// 모바일: 44×44px(터치 타깃 최소) — 줄 높이도 44px 로 늘리고, 가로는 두 열 스위치 간격(48px) 안이라 서로 겹치지 않는다.
const SWITCH_HIT = "relative after:absolute after:content-['']"
const switchHit = (compact: boolean) =>
  cn(SWITCH_HIT, compact ? 'after:-inset-x-1.5 after:-inset-y-[13px]' : 'after:-inset-x-3 after:-inset-y-[11px]')

const ACTORS: { actor: NotificationActor; label: string; short: string; aria: string }[] = [
  { actor: 'HUMAN', label: '사람이', short: '사람', aria: '사람이 했을 때' },
  { actor: 'AGENT', label: 'AI가', short: 'AI', aria: 'AI가 했을 때' },
]

export function NotificationSettingsMatrix({ settings, saving, compact, onAppChange, onCellChange }: NotificationSettingsMatrixProps) {
  // 모바일 펼친 카드 — 화면 로컬 상태(저장 안 함). 처음엔 알림이 가장 많은 이슈 카드만 펼쳐 첫 화면에 한 카드만 보이게 한다.
  const [expanded, setExpanded] = useState<ReadonlySet<NotificationApp>>(() => new Set<NotificationApp>(['ISSUE']))
  const toggleExpanded = (app: NotificationApp) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(app)) next.delete(app)
      else next.add(app)
      return next
    })
  return (
    <div data-testid="notif-settings-matrix" className="space-y-3">
      {/* 모르는 앱·항목(새 서버가 먼저 배포된 경우)은 건너뛴다 — knownApps 참고. */}
      {knownApps(settings.apps).map((a) => (
        <AppCard
          key={a.app}
          app={a}
          compact={compact}
          // 데스크톱은 접기 UI 없이 늘 펼친다.
          open={!compact || expanded.has(a.app)}
          onToggleOpen={() => toggleExpanded(a.app)}
          saving={saving}
          onAppChange={onAppChange}
          onCellChange={onCellChange}
        />
      ))}
    </div>
  )
}

function AppCard({
  app: a,
  compact,
  open,
  onToggleOpen,
  saving,
  onAppChange,
  onCellChange,
}: {
  app: NotificationAppSetting
  compact: boolean
  open: boolean
  onToggleOpen: () => void
  saving: boolean
  onAppChange: NotificationSettingsMatrixProps['onAppChange']
  onCellChange: NotificationSettingsMatrixProps['onCellChange']
}) {
  const appLabel = APP_LABEL[a.app]
  const appNote = APP_NOTE[a.app]
  const switchId = useId()
  // 「앱 전체」 글자 + 앱 스위치 묶음 — 데스크톱·모바일 머리가 같이 쓰고 여백만 다르다.
  // 글자는 <label htmlFor> 라 눌러도 스위치가 바뀐다(WP-935, 모바일에서 작은 스위치만 노리지 않게).
  // 낭독 이름은 스위치 aria-label(「… 앱 전체」)이 정하므로 글자는 aria-hidden — 이름이 두 번 읽히지 않는다.
  // 모바일 pr-5: 스위치 중심을 아래 AI 열(2.5rem, 줄 px-4) 스위치 중심과 같은 x(오른쪽에서 36px)에 맞춘다.
  const appToggle = (
    <div className={cn('flex shrink-0 items-center gap-2 text-xs text-muted-foreground', compact && 'pr-5 pl-2')}>
      <label htmlFor={switchId} aria-hidden="true" className="cursor-pointer select-none">
        앱 전체
      </label>
      <BusySwitch
        id={switchId}
        data-testid={`notif-app-toggle-${a.app}`}
        className={switchHit(compact)}
        checked={a.enabled}
        busy={saving}
        onCheckedChange={(v) => onAppChange(a.app, v)}
        aria-label={`${appLabel} 앱 전체`}
      />
    </div>
  )
  return (
    // 접기/펼치기는 디자인 시스템 Collapsible(04-components) — aria-expanded·aria-controls 를 트리거에 자동으로 붙인다.
    // 데스크톱은 open 이 늘 true 이고 트리거가 없어 접히지 않는다.
    <Collapsible asChild open={open} onOpenChange={onToggleOpen}>
      <section
        data-testid={`notif-app-${a.app}`}
        aria-label={appLabel}
        className="overflow-hidden rounded-md border bg-card text-card-foreground"
      >
        {/* 카드 머리 — 앱 이름과 「앱 전체」 스위치. 끄면 칸 값은 서버에 남고 칸만 꺼진 채 잠긴다. */}
        {compact ? (
          // 모바일: 머리가 펼침 버튼. 앱 스위치는 버튼 안이 아닌 바깥 형제 — 중첩 인터랙티브를 피하고, 스위치를 눌러도 펼침이 바뀌지 않게 한다.
          <div className="flex items-center bg-muted/50">
            <h3 className="min-w-0 flex-1">
              <CollapsibleTrigger
                data-testid={`notif-app-expand-${a.app}`}
                className="flex min-h-11 w-full items-center gap-1.5 px-4 text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="truncate">{appLabel}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')}
                />
              </CollapsibleTrigger>
            </h3>
            {appToggle}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 bg-muted/50 px-4 py-2.5">
            <h3 className="text-sm font-semibold">{appLabel}</h3>
            {appToggle}
          </div>
        )}
        <CollapsibleContent>
          {/* 앱별 안내(채팅: 푸시로만 알림) — 열 머리 위 첫 줄. 모바일은 카드를 펼쳤을 때 보인다(APP_NOTE 참고). */}
          {appNote != null && (
            <p data-testid={`notif-app-note-${a.app}`} className="border-t px-4 py-2 text-xs text-muted-foreground">
              {appNote}
            </p>
          )}
          {/* 열 머리 — 카드마다 둬서 어느 카드를 봐도 열 뜻을 바로 안다. 낭독기는 칸 스위치 이름으로 듣는다. */}
          <div className={cn(ROW_GRID, gridCols(compact), 'border-t py-1.5')} aria-hidden="true">
            <span />
            {ACTORS.map((c) => (
              <span key={c.actor} data-testid={`notif-col-${c.actor}`} className="text-center text-xs text-muted-foreground">
                {compact ? c.short : c.label}
              </span>
            ))}
          </div>
          {a.items.map((it) => (
            <ItemRow
              key={it.item}
              item={it}
              appEnabled={a.enabled}
              compact={compact}
              saving={saving}
              onCellChange={onCellChange}
            />
          ))}
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function ItemRow({
  item,
  appEnabled,
  compact,
  saving,
  onCellChange,
}: {
  item: NotificationItemSetting
  appEnabled: boolean
  compact: boolean
  saving: boolean
  onCellChange: NotificationSettingsMatrixProps['onCellChange']
}) {
  const meta = ITEM_META[item.item]
  return (
    <div className={cn(ROW_GRID, gridCols(compact), 'border-t', compact ? 'min-h-11 py-3' : 'min-h-10 py-2.5')}>
      {/* 앱이 꺼지면 항목 이름도 흐리게 — 라이트 모드에선 흐린 꺼짐 스위치만으로는 「그냥 꺼짐」과 「잠김」이 잘 구분되지 않았다(WP-913 시각 검수). */}
      <div className={cn('min-w-0', !appEnabled && 'text-muted-foreground')}>
        <div className="text-sm leading-5 font-medium">
          {meta.label}
          {/* AI 가 맡은 작업에서만 생기는 알림 — 디자인 시스템 AI 신호 배지(07-iconography §7.2, ai-accent 토큰).
              배지가 sr-only 「AI」를 이미 읽으므로 보이는 글자는 낭독에서 뺀다(「AI AI」 중복 방지). */}
          {meta.ai && (
            <AiSignalBadge variant="info" className="ml-1 align-middle">
              <span aria-hidden="true">AI</span>
            </AiSignalBadge>
          )}
        </div>
        {/* 설명은 데스크톱에서만 — 모바일은 폭이 좁아 이름만 둔다(시안). */}
        {!compact && meta.description != null && <div className="text-xs text-muted-foreground">{meta.description}</div>}
      </div>
      {ACTORS.map((c) => {
        const view = cellView(appEnabled, c.actor === 'HUMAN' ? item.human : item.agent)
        // 칸이 없는 쪽은 빈 자리 — 스위치를 그리지 않는다(예: 답변 필요의 사람이).
        if (!view.present) return <span key={c.actor} />
        return (
          <div key={c.actor} className="flex justify-center">
            <BusySwitch
              data-testid={`notif-cell-${item.item}-${c.actor}`}
              className={switchHit(compact)}
              checked={view.checked}
              // 앱이 꺼지면 칸은 정말 쓸 수 없으므로 disabled. 저장 중 잠금은 busy(초점 유지).
              disabled={view.locked}
              busy={saving}
              onCheckedChange={(v) => onCellChange(item.item, c.actor, v)}
              aria-label={`${meta.label} — ${c.aria}`}
            />
          </div>
        )
      })}
    </div>
  )
}
