// /apps/tabs — 탭바 3칸 구성·순서 편집(WP-126). AI(가운데)·앱(끝)은 고정 표시만.
// 앱 목록의 길게 누르기(고정·교체)가 빠른 교체라면, 이 화면은 칸 순서 조정까지 하는 상세 편집이다.
// 드래그 대신 위/아래·추가/제거 버튼으로 편집한다(접근성·단순성). 모바일 전용.
// 앱 목록에서 들어오는 푸시 화면 — ‹(앱 목록) + 제목 + 우측 [저장] 헤더, 탭바 없음(U2-2).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useTabSlots } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'

// 탭바 사용자 칸 수(AI·앱 제외).
const SLOT_COUNT = 3
// 편집 아이콘 버튼 — 44×44 터치 타깃.
const ICON_BTN = 'flex h-11 w-11 shrink-0 items-center justify-center text-lg disabled:opacity-30'

export default function TabEditPage() {
  const [saved, save] = useTabSlots()
  // 저장 전까지는 로컬 초안만 바꾼다(저장 시 탭바·localStorage 에 반영).
  const [draft, setDraft] = useState<MobileTabId[]>(saved)
  const navigate = useNavigate()
  const move = (i: number, d: -1 | 1) =>
    setDraft((s) => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })
  const candidates = ALL_TAB_IDS.filter((id) => !draft.includes(id))
  const full = draft.length >= SLOT_COUNT
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 저장은 헤더 우측(스크롤 안에 두지 않음) — 3칸을 채워야 활성. 뒤로가기 = 앱 목록(moduleRootFor). */}
      <MobileDetailBar
        data-testid="tab-edit-header"
        title="탭바 순서 편집"
        trailing={
          <button
            type="button"
            data-testid="tab-edit-save"
            disabled={draft.length !== SLOT_COUNT}
            onClick={() => { save(draft); navigate('/apps') }}
            className="flex h-11 shrink-0 items-center px-3 text-[15px] font-semibold text-primary disabled:text-muted-foreground disabled:opacity-60"
          >
            저장
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <p className="px-4 pt-3 text-xs text-muted-foreground">가운데 AI 와 끝의 앱은 고정입니다. 나머지 3칸을 고르세요.</p>
        <ul className="mt-2 border-y">
          {draft.map((id, i) => {
            const t = MOBILE_TABS[id]
            const Icon = t.icon
            return (
              <li key={id} data-testid={`tab-edit-slot-${i}`} className="flex min-h-11 items-center gap-2 border-b pl-4 pr-1 last:border-b-0">
                <Icon className="h-4 w-4" /><span className="flex-1 text-sm">{t.label}</span>
                <button type="button" data-testid={`tab-edit-up-${i}`} aria-label={`${t.label} 위로`} disabled={i === 0} onClick={() => move(i, -1)} className={ICON_BTN}>↑</button>
                <button type="button" data-testid={`tab-edit-down-${i}`} aria-label={`${t.label} 아래로`} disabled={i === draft.length - 1} onClick={() => move(i, 1)} className={ICON_BTN}>↓</button>
                <button type="button" data-testid={`tab-edit-remove-${i}`} aria-label={`${t.label} 빼기`} onClick={() => setDraft((s) => s.filter((x) => x !== id))} className={`${ICON_BTN} text-destructive`}>−</button>
              </li>
            )
          })}
        </ul>
        <p className="px-4 pt-4 text-xs font-semibold text-muted-foreground">추가할 수 있는 앱</p>
        {/* 3칸이 차 있으면 ＋ 가 모두 비활성 — 이유와 방법을 먼저 알려준다. */}
        {full && (
          <p data-testid="tab-edit-full-hint" className="px-4 pt-1 text-xs text-muted-foreground">
            탭바가 꽉 찼어요 — 하나를 빼면 추가할 수 있어요
          </p>
        )}
        <ul>
          {candidates.map((id) => {
            const t = MOBILE_TABS[id]
            const Icon = t.icon
            return (
              <li key={id} className="flex min-h-11 items-center gap-2 pl-4 pr-1">
                <Icon className="h-4 w-4" /><span className="flex-1 text-sm">{t.label}</span>
                <button type="button" data-testid={`tab-edit-add-${id}`} aria-label={`${t.label} 추가`} disabled={full} onClick={() => setDraft((s) => [...s, id])} className={`${ICON_BTN} text-primary`}>＋</button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
