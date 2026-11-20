// /apps/tabs — 탭바 칸 구성·순서 편집(WP-126). AI(가운데, 쓸 수 있을 때만)·앱(끝)은 고정 표시만.
// 칸 수는 지금 화면이 보여 주는 만큼(넓은 폰 5칸·좁은 폰 3칸, WP-877) — 구성은 기기별 저장이라 화면에 맞추면 충분해 안 보이는 칸 안내는 두지 않는다.
// 앱 목록의 길게 누르기(고정·교체)가 빠른 교체라면, 이 화면은 칸 순서 조정까지 하는 상세 편집이다.
// 드래그 대신 위/아래·추가/제거 버튼으로 편집한다(접근성·단순성). 모바일 전용.
// 앱 목록에서 들어오는 푸시 화면 — ‹(앱 목록) + 제목 + 우측 [저장] 헤더, 탭바 없음(U2-2).
// WP-1833: 저장하지 않은 초안(changed)으로 ‹ 를 누르면 바로 나가지 않고 버릴지 묻는다(칸이 덜 찬 초안 포함).
// WP-1849: 시스템 뒤로가기(popstate)도 같은 확인을 띄운다 — 바뀐 초안 동안만 useSheetHistory 의 표식 항목(historyKey 'tabEdit')을 둔다.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useTabSlots } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { useMobileBack } from '@/components/mobile/useMobileBack'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useSheetHistory } from '@/hooks/useSheetHistory'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { isHistoryEntryWithdrawn } from '@/lib/historyParam'
import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'
import { eulReul, euroRo } from '@/lib/utils'

// 편집 아이콘 버튼 — 44×44 터치 타깃.
const ICON_BTN = 'flex h-11 w-11 shrink-0 items-center justify-center text-lg disabled:opacity-30'

/** 탭바 칸 편집기 — 지금 보이는 칸 수만큼 고른다. */
export default function TabEditPage() {
  const [saved, save] = useTabSlots()
  // 저장 전까지는 로컬 초안만 바꾼다(저장 시 탭바·localStorage 에 반영).
  const [draft, setDraft] = useState<MobileTabId[]>(saved)
  // 저장 안 한 초안으로 ‹ 를 눌렀을 때의 확인 대화상자.
  const [confirmLeave, setConfirmLeave] = useState(false)
  // 편집 중 화면을 돌려 칸 수가 바뀌면(3↔5) 초안을 새 칸 수의 저장 구성으로 제자리에서 다시 잡는다 —
  // 그대로 두면 초안과 칸 수가 어긋나 저장·추가가 막힌다. 이때 저장 안 한 초안(과 열린 버림 확인)도 함께 사라진다(WP-1833 범위 밖 — 묻지 않는다).
  // key 로 편집기를 다시 마운트하지 않는 까닭(WP-1849): 표식이 살아 있으면 새 편집기의 표식 정리(replace)가 옛 편집기의 표식 제거(popMark)보다 먼저 돌아
  // 히스토리가 [/apps, /apps/tabs, /apps/tabs] 로 남는다. 제자리에서 맞추면 changed 가 true→false 로 바뀌어 훅이 표식을 정상으로 걷는다.
  // 렌더 중 상태 맞추기(React 「이전 props 로 state 조정」) — 이전 칸 수를 state 로 들고 달라지면 바로 맞춘다.
  // 「버리고 나가기」·「저장」으로 나가는 중 — 훅의 open 을 끄고(표식 걷기·재심기 막기) 걷힌 뒤 back 을 한 번 부른다(WP-1849).
  const [leaving, setLeaving] = useState(false)
  // 조작 뒤 초점 잇기·알림(WP-846): 다시 그린 뒤 초점을 옮길 버튼 후보와 라이브 영역 문구.
  const focusNext = useRef<string[] | null>(null)
  const [live, setLive] = useState('')
  const slotCount = saved.length
  const [prevSlotCount, setPrevSlotCount] = useState(slotCount)
  if (prevSlotCount !== slotCount) {
    setPrevSlotCount(slotCount)
    setDraft(saved)
    setConfirmLeave(false)
    // 옛 key 재마운트가 비워 주던 것들 — 나가는 중 상태·알림 문구를 함께 비운다(초점 대기 ref 는 아래 효과가 비운다).
    setLeaving(false)
    setLive('')
  }
  // 탭바 사용자 칸 수(AI·앱 제외) — 지금 화면에서 보이는 칸 수.
  // AI 비서를 쓸 수 없으면 탭바에 가운데 AI 칸이 없다(MobileTabBar) — 안내도 실제 탭바 모양에 맞춘다(WP-880).
  const aiAvailable = useAiAvailable()
  // ‹ 의 기본 이동(히스토리/앱 목록) — 바뀐 것이 없거나 「버리고 나가기」일 때 쓴다.
  const back = useMobileBack()
  const candidates = ALL_TAB_IDS.filter((id) => !draft.includes(id))
  const full = draft.length >= slotCount
  // 저장은 바뀐 것이 있을 때만(U3-R9) — 순서까지 같은지 칸별로 비교한다. 칸을 다 채워야 저장할 수 있다.
  const changed = draft.length !== saved.length || draft.some((id, i) => id !== saved[i])
  const canSave = draft.length === slotCount && changed
  // 초안이 바뀐 동안은 새로고침·창 닫기에 브라우저 확인을 띄우고, 새 버전 자동 새로고침도 미룬다(WP-664 — 「저장 안 한 입력」).
  useUnsavedChangesWarning(changed)

  // 바뀐 초안 동안 히스토리 표식 1개를 둔다 — 시스템 back 은 표식만 걷히고(화면 유지) 훅이 표식을 다시 심은 뒤 확인창을 띄운다.
  useSheetHistory({
    historyKey: 'tabEdit',
    open: changed && !leaving,
    hasContent: true,
    onClose: () => {},
    onBlockedBack: () => setConfirmLeave(true),
  })
  const { key: locationKey } = useLocation()
  // 나가는 이동(back)을 이미 불렀는지 — navigate(-1) 은 비동기라 위치가 그대로인 동안 두 번 부르지 않게 한다.
  const navigated = useRef(false)
  useEffect(() => {
    // 나가는 중이고 라우터 위치가 표식 없는 브라우저 항목을 따라잡았을 때 한 번만 이동한다(표식 정리 중에 back 하면 낡은 위치에서 움직인다).
    if (!leaving || navigated.current || !isHistoryEntryWithdrawn('tabEdit', locationKey)) return
    navigated.current = true
    back()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leaving·위치가 바뀔 때만 확인(back 은 렌더마다 새 함수)
  }, [leaving, locationKey])

  /**
   * 「버리고 나가기」·「저장」 — leaving 을 켜 훅의 open 을 끄면(막힌 back 직후 대기 중인 재심기도 막는다) 훅이 표식을 걷고,
   * 위 효과가 걷힌 위치에서 back 한다(표식이 이미 없으면 바로). 그냥 back 하면 표식만 걷히고 훅이 다시 심어 확인창이 또 뜬다(WP-1849).
   */
  function leave(): void {
    setLeaving(true)
  }

  // 헤더 ‹ — 바뀐 초안이면 버릴지 묻고 아니면 기본 이동. 나가는 중에는 무시한다(확인창이 한 번 더 뜨지 않게).
  function handleBack(): void {
    if (leaving) return
    if (changed) setConfirmLeave(true)
    else back()
  }

  // 조작 뒤 초점 잇기·알림(WP-846) — 경계로 옮긴 「위로/아래로」, 빠진 행의 「빼기」, 칸이 다 차 꺼진 「＋」는 눌린 버튼이
  // 사라지거나 disabled 가 되어 초점이 body 로 사라졌다. 다시 그린 뒤 이어서 쓸 수 있는 버튼(후보를 앞에서부터)으로 옮기고,
  // 바뀐 내용을 라이브 영역으로 알린다(보드·드라이브·대시보드 WP-837·840·842 와 같은 기준).
  // 칸 수가 바뀌면 낡은 초점 대기를 버린다 — 렌더 중에는 ref 를 못 만지므로 효과로(아래 [draft] 효과보다 먼저 돌아야 한다).
  useEffect(() => { focusNext.current = null }, [slotCount])
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
        // 나가는 중(leaving)에는 확인을 다시 열지 않는다 — 표식을 걷는 사이 ‹ 를 눌러도 아무 일도 없다.
        onBack={handleBack}
        trailing={
          <button
            type="button"
            data-testid="tab-edit-save"
            disabled={!canSave}
            // WP-1849: 저장 뒤 '/apps' 를 push 하지 않고 leave() 로 앞 화면에 돌아간다 — push 하면 뒤로가기가 편집 화면을 다시 연다.
            onClick={() => { save(draft); leave() }}
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
      {/* 고친 구성을 두고 ‹ 로 나갈 때의 확인 — 저장하지 않은 채 나가면 초안이 사라진다. */}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent data-testid="tab-edit-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>저장하지 않은 변경을 버릴까요?</AlertDialogTitle>
            <AlertDialogDescription>나가면 고친 탭바 구성이 사라집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="tab-edit-discard-keep">계속 편집</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="tab-edit-discard-confirm" onClick={leave}>
              버리고 나가기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
