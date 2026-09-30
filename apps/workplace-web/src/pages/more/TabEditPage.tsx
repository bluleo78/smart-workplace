// /more/tabs — 탭바 3칸 구성 편집(WP-126). AI(가운데)·더보기(끝)는 고정 표시만.
// 드래그 대신 위/아래·추가/제거 버튼으로 편집한다(접근성·단순성). 모바일 전용.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useTabSlots } from '@/components/mobile/MobileChromeContext'
import { MobileListHeader } from '@/components/mobile/MobileListHeader'
import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'

export default function TabEditPage() {
  const [saved, save] = useTabSlots()
  // 저장 전까지는 로컬 초안만 바꾼다(저장 시 탭바·localStorage 에 반영).
  const [draft, setDraft] = useState<MobileTabId[]>(saved)
  const navigate = useNavigate()
  const move = (i: number, d: -1 | 1) =>
    setDraft((s) => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })
  const candidates = ALL_TAB_IDS.filter((id) => !draft.includes(id))
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <MobileListHeader title="탭바 편집" hideBell />
      <p className="px-4 text-xs text-muted-foreground">가운데 AI 와 끝의 더보기는 고정입니다. 나머지 3칸을 고르세요.</p>
      <ul className="mt-2 border-y">
        {draft.map((id, i) => {
          const t = MOBILE_TABS[id]
          const Icon = t.icon
          return (
            <li key={id} data-testid={`tab-edit-slot-${i}`} className="flex min-h-11 items-center gap-2 border-b px-4">
              <Icon className="h-4 w-4" /><span className="flex-1 text-sm">{t.label}</span>
              <button data-testid={`tab-edit-up-${i}`} aria-label={`${t.label} 위로`} disabled={i === 0} onClick={() => move(i, -1)} className="h-11 w-9 disabled:opacity-30">↑</button>
              <button data-testid={`tab-edit-down-${i}`} aria-label={`${t.label} 아래로`} disabled={i === draft.length - 1} onClick={() => move(i, 1)} className="h-11 w-9 disabled:opacity-30">↓</button>
              <button data-testid={`tab-edit-remove-${i}`} aria-label={`${t.label} 빼기`} onClick={() => setDraft((s) => s.filter((x) => x !== id))} className="h-11 w-9 text-destructive">−</button>
            </li>
          )
        })}
      </ul>
      <p className="px-4 pt-4 text-xs font-semibold text-muted-foreground">추가할 수 있는 앱</p>
      <ul>
        {candidates.map((id) => {
          const t = MOBILE_TABS[id]
          const Icon = t.icon
          return (
            <li key={id} className="flex min-h-11 items-center gap-2 px-4">
              <Icon className="h-4 w-4" /><span className="flex-1 text-sm">{t.label}</span>
              <button data-testid={`tab-edit-add-${id}`} aria-label={`${t.label} 추가`} disabled={draft.length >= 3} onClick={() => setDraft((s) => [...s, id])} className="h-11 w-9 text-primary disabled:opacity-30">＋</button>
            </li>
          )
        })}
      </ul>
      <button data-testid="tab-edit-save" disabled={draft.length !== 3} onClick={() => { save(draft); navigate('/more') }}
        className="mx-4 my-4 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">저장</button>
    </div>
  )
}
