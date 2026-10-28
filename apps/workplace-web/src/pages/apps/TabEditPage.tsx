// /apps/tabs — 탭바 칸 구성·순서 편집(WP-126). AI(가운데, 쓸 수 있을 때만)·앱(끝)은 고정 표시만.
// 칸 수는 지금 화면이 보여 주는 만큼(넓은 폰 5칸·좁은 폰 3칸, WP-877) — 구성은 기기별 저장이라 화면에 맞추면 충분해 안 보이는 칸 안내는 두지 않는다.
// 앱 목록의 길게 누르기(고정·교체)가 빠른 교체라면, 이 화면은 칸 순서 조정까지 하는 상세 편집이다.
// 드래그 대신 위/아래·추가/제거 버튼으로 편집한다(접근성·단순성). 모바일 전용.
// 앱 목록에서 들어오는 푸시 화면 — ‹(앱 목록) + 제목 + 우측 [저장] 헤더, 탭바 없음(U2-2).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useTabSlots } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'
import { eulReul, euroRo } from '@/lib/utils'

// 편집 아이콘 버튼 — 44×44 터치 타깃.
const ICON_BTN = 'flex h-11 w-11 shrink-0 items-center justify-center text-lg disabled:opacity-30'

export default function TabEditPage() {
  const [saved] = useTabSlots()
  // 편집 중 화면을 돌려 칸 수가 바뀌면(3↔5) 편집기를 새로 띄워 초안을 새 칸 수의 저장 구성으로 다시 잡는다 —
  // 그대로 두면 초안과 칸 수가 어긋나 저장·추가가 막힌다.
  return <TabEditor key={saved.length} />
}

/** 탭바 칸 편집기 — 지금 보이는 칸 수만큼 고른다. */
function TabEditor() {
  const [saved, save] = useTabSlots()
  // 저장 전까지는 로컬 초안만 바꾼다(저장 시 탭바·localStorage 에 반영).
  const [draft, setDraft] = useState<MobileTabId[]>(saved)
  // 탭바 사용자 칸 수(AI·앱 제외) — 지금 화면에서 보이는 칸 수.
  const slotCount = saved.length
  // AI 비서를 쓸 수 없으면 탭바에 가운데 AI 칸이 없다(MobileTabBar) — 안내도 실제 탭바 모양에 맞춘다(WP-880).
  const aiAvailable = useAiAvailable()
  const navigate = useNavigate()
  const candidates = ALL_TAB_IDS.filter((id) => !draft.includes(id))
  const full = draft.length >= slotCount
  // 저장은 바뀐 것이 있을 때만(U3-R9) — 순서까지 같은지 칸별로 비교한다. 칸을 다 채워야 저장할 수 있다.
  const changed = draft.length !== saved.length || draft.some((id, i) => id !== saved[i])
  const canSave = draft.length === slotCount && changed

  // 조작 뒤 초점 잇기·알림(WP-846) — 경계로 옮긴 「위로/아래로」, 빠진 행의 「빼기」, 칸이 다 차 꺼진 「＋」는 눌린 버튼이
  // 사라지거나 disabled 가 되어 초점이 body 로 사라졌다. 다시 그린 뒤 이어서 쓸 수 있는 버튼(후보를 앞에서부터)으로 옮기고,
  // 바뀐 내용을 라이브 영역으로 알린다(보드·드라이브·대시보드 WP-837·840·842 와 같은 기준).
  const focusNext = useRef<string[] | null>(null)
  const [live, setLive] = useState('')
  useEffect(() => {
    const ids = focusNext.current
    if (!ids) return
    focusNext.current = null
    for (const id of ids) {
      const el = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
      if (el && !el.disabled) { el.focus(); return }
    }
  }, [draft])
  const labelOf = (id: MobileTabId) => MOBILE_TABS[id].label

  function move(i: number, d: -1 | 1) {
    const j = i + d
    const label = labelOf(draft[i])
    // 같은 방향 버튼이 경계에서 꺼지면 반대 방향 버튼으로.
    focusNext.current = d < 0 ? [`tab-edit-up-${j}`, `tab-edit-down-${j}`] : [`tab-edit-down-${j}`, `tab-edit-up-${j}`]
    setLive(`${label}${eulReul(label)} ${j + 1}번째 칸${euroRo(`${j + 1}번째 칸`)} 옮겼습니다`)
    setDraft((s) => { const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n })
  }

  function remove(i: number) {
    const id = draft[i]
    const rest = draft.length - 1
    // 같은 자리(마지막이었으면 앞) 칸의 「빼기」 → 남은 칸이 없으면 방금 뺀 앱의 「＋」.
    focusNext.current = rest > 0 ? [`tab-edit-remove-${Math.min(i, rest - 1)}`] : [`tab-edit-add-${id}`]
    setLive(`${labelOf(id)}${eulReul(labelOf(id))} 탭바에서 뺐습니다`)
    setDraft((s) => s.filter((x) => x !== id))
  }

  function add(id: MobileTabId) {
    const at = candidates.indexOf(id)
    const rest = candidates.filter((x) => x !== id)
    // 아직 칸이 남으면 같은 자리의 다음 후보 「＋」, 꽉 찼으면 「저장」(바뀐 게 없어 꺼져 있으면 추가한 칸의 「빼기」).
    focusNext.current = draft.length + 1 < slotCount && rest.length > 0
      ? [`tab-edit-add-${rest[Math.min(at, rest.length - 1)]}`]
      : ['tab-edit-save', `tab-edit-remove-${draft.length}`]
    setLive(`${labelOf(id)}${eulReul(labelOf(id))} ${draft.length + 1}번째 칸에 추가했습니다`)
    setDraft((s) => [...s, id])
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 저장은 헤더 우측(스크롤 안에 두지 않음) — 칸을 다 채우고 바뀐 것이 있어야 활성. 뒤로가기 = 앱 목록(moduleRootFor). */}
      {/* ✦ 없음 — 탭바 구성 화면이라 AI 에 물을 화면 컨텍스트가 없다(U3-R9). */}
      <MobileDetailBar
        data-testid="tab-edit-header"
        title="탭바 순서 편집"
        showAi={false}
        trailing={
          <button
            type="button"
            data-testid="tab-edit-save"
            disabled={!canSave}
            onClick={() => { save(draft); navigate('/apps') }}
            className="flex h-11 shrink-0 items-center px-3 text-[15px] font-semibold text-primary disabled:text-muted-foreground disabled:opacity-60"
          >
            저장
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <p data-testid="tab-edit-intro" className="px-4 pt-3 text-xs text-muted-foreground">
          {aiAvailable ? '가운데 AI 와 끝의 앱은' : '끝의 앱은'} 고정입니다. 나머지 {slotCount}칸을 고르세요.
        </p>
        <ul className="mt-2 border-y">
          {draft.map((id, i) => {
            const t = MOBILE_TABS[id]
            const Icon = t.icon
            return (
              <li key={id} data-testid={`tab-edit-slot-${i}`} className="flex min-h-11 items-center gap-2 row-divider pl-4 pr-1 last:border-b-0">
                <Icon className="h-4 w-4" /><span className="flex-1 text-sm">{t.label}</span>
                <button type="button" data-testid={`tab-edit-up-${i}`} aria-label={`${t.label} 위로`} disabled={i === 0} onClick={() => move(i, -1)} className={ICON_BTN}>↑</button>
                <button type="button" data-testid={`tab-edit-down-${i}`} aria-label={`${t.label} 아래로`} disabled={i === draft.length - 1} onClick={() => move(i, 1)} className={ICON_BTN}>↓</button>
                <button type="button" data-testid={`tab-edit-remove-${i}`} aria-label={`${t.label} 빼기`} onClick={() => remove(i)} className={`${ICON_BTN} text-destructive`}>−</button>
              </li>
            )
          })}
        </ul>
        <p className="px-4 pt-4 text-xs font-semibold text-muted-foreground">추가할 수 있는 앱</p>
        {/* 칸이 다 차 있으면 ＋ 가 모두 비활성 — 이유와 방법을 먼저 알려준다. */}
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
                <button type="button" data-testid={`tab-edit-add-${id}`} aria-label={`${t.label} 추가`} disabled={full} onClick={() => add(id)} className={`${ICON_BTN} text-primary`}>＋</button>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite" data-testid="tab-edit-live">{live}</p>
    </div>
  )
}
