// 휴대폰 도움말 시트(WP-1505) — 탭 첫 화면 헤더 「?」로 여는 전체 화면 시트. 내용은 데스크톱과 같은 HelpPanel 이다.
// - 뒤로 가기 = 닫기: 열 때 같은 주소의 히스토리 항목을 하나 넣는다(useSheetHistory).
// - 한 번에 하나: 휴대폰은 좁아 도움말 시트와 AI 시트를 함께 두지 않는다. 둘 다 자기 히스토리 항목을 가지므로 순서를 지킨다 —
//   ① 도움말이 열린 채 AI 가 열리면(⌘K 등) AI 를 잠시 내리고 도움말 항목을 걷은 뒤 AI 를 다시 연다(AI 항목이 도움말 항목을 이어받아
//      그대로 두면 도움말을 닫는 뒤로 가기가 AI 까지 닫는다). AI 가 히스토리 항목 없이 열린 경우(딥링크·셸 전환 등)도 같다 —
//      걷을 AI 항목만 없을 뿐, 도움말 항목을 걷는 뒤로 가기가 표식 없는 전체 화면 AI 를 닫으므로 내렸다가 제 항목으로 다시 연다.
//   ② AI 가 열린 채 도움말을 열면(`?`·헤더 「?」) AI 를 닫고, AI 항목이 걷힌 뒤에 도움말을 보인다.
//   ③ 「✦ AI에게 묻기」는 도움말을 닫고 그 항목이 걷힌 뒤 AI 를 연다(①과 같은 이유).
// 모달 대화상자(Radix)로 그린다 — 그림 확대 대화상자·⌄ 목록 팝오버·경로 「…」 메뉴가 시트 위에 뜨고, 포커스가 시트 안에 갇힌다.
// 대화상자가 열려 있으면 `?` 단축키는 무시되므로(isHelpShortcut) 휴대폰 시트는 ✕·뒤로 가기로 닫는다.
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { AI_HISTORY_KEY, useAssistant } from '@/components/ai/AIAssistantContext'
import { RawSheetContent } from '@/components/mobile/RawSheetContent'
import { useSheetHistory } from '@/hooks/useSheetHistory'
import { hasLiveStateMark, liveHistoryKey } from '@/lib/historyParam'

import { useHelpPanel } from './HelpPanelContext'
import { LazyHelpPanel } from './LazyHelpPanel'

/** 시트 히스토리 표식 키(router state). */
const HISTORY_KEY = 'helpSheet'
/** 닫을 때 확인할 내용이 없는 시트라 뒤로 가기 확인을 띄우지 않는다(hasContent=false) — 불리지 않는다. */
const noop = () => {}

export function MobileHelpSheet() {
  const { open, setOpen } = useHelpPanel()
  const ai = useAssistant()
  const aiOpen = ai.mode !== 'closed'
  // 보이는 조건 — 도움말을 열었고 지금 항목이 AI 전체 화면 항목이 아닐 때. AI 모드(aiOpen)가 아니라 AI 항목(historyOpen)을 보는 이유:
  // AI 가 열린 렌더에는 라우터 위치가 아직 AI 를 연 push 전일 수 있어, 그때 도움말을 닫으면 낡은 위치로 계산한 뒤로 가기가
  // 도움말 항목까지만 걷고 AI 항목은 남긴다. AI 항목이 위치에 실린 뒤에 닫아야 두 항목을 함께 걷는다(①).
  // ②에서도 AI 항목이 걷히기 전에 도움말 항목을 넣으면 그 항목이 AI 표식을 이어받아, 도움말을 닫는 뒤로 가기가 AI 를 다시 연다.
  const visible = open && !ai.historyOpen

  useSheetHistory({ historyKey: HISTORY_KEY, open: visible, hasContent: false, onClose: () => setOpen(false), onBlockedBack: noop })

  // 도움말 항목이 걷힌 뒤 열 AI(①·③).
  const pendingAi = useRef(false)

  // 한 번에 하나 — 어느 쪽이 나중에 열렸는지 기억해 닫을 쪽을 고른다.
  const lastOpened = useRef<'help' | 'ai' | null>(null)
  const prev = useRef({ open, aiOpen })
  useEffect(() => {
    const p = prev.current
    prev.current = { open, aiOpen }
    if (open && !p.open) lastOpened.current = 'help'
    else if (aiOpen && !p.aiOpen) lastOpened.current = 'ai'
    if (!open || !aiOpen) return
    if (lastOpened.current === 'help') {
      // ② 도움말이 나중 — AI 를 닫는다(전체 화면이면 그 항목을 되돌린다). 도움말은 AI 항목이 걷힌 뒤 visible 이 된다.
      ai.close()
    } else if (ai.historyOpen || !hasLiveStateMark(AI_HISTORY_KEY)) {
      // ① AI 가 나중 — AI 항목이 위치에 실린 뒤, AI 를 히스토리 그대로 내리고 도움말을 닫는다.
      // 도움말을 닫는 뒤로 가기가 그 위 AI 항목까지 걷고 나면 아래 효과가 AI 를 다시 연다.
      // AI 가 항목 없이 열렸으면(브라우저 기록에도 AI 표식이 없음) 기다릴 것 없이 바로 같은 순서를 밟는다 — 걷는 것은 도움말 항목뿐이다.
      // 기록에는 AI 표식이 있는데 라우터 위치가 아직 따라오지 않았으면(push 직후 렌더) historyOpen 이 켜질 때까지 기다린다.
      pendingAi.current = true
      ai.dismiss()
      setOpen(false)
    }
  }, [open, aiOpen, ai, setOpen])

  // 도움말 항목이 걷혔으면 미뤄 둔 AI 를 연다. 걷을 항목이 없었으면(새로고침 뒤 등) 바로 연다.
  // 브라우저가 이미 돌아갔어도 라우터 위치가 따라오기 전이면(liveHistoryKey ≠ 렌더한 위치 key) 기다린다 — AI 의 히스토리 push 는
  // 낡은 위치에서 부르면 아무 일도 하지 않아(useHistoryParam 스냅숏 검사) 뒤로 가기로 닫히지 않는 AI 가 된다.
  const { key } = useLocation()
  useEffect(() => {
    if (!pendingAi.current || open || hasLiveStateMark(HISTORY_KEY) || liveHistoryKey() !== key) return
    pendingAi.current = false
    ai.open('side')
  }, [key, open, ai])

  // ③ 「✦ AI에게 묻기」 — 도움말을 먼저 닫고 AI 는 미룬다.
  const askAi = useCallback(() => {
    pendingAi.current = true
    setOpen(false)
  }, [setOpen])

  if (!visible) return null
  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && setOpen(false)}>
      <DialogPrimitive.Portal>
        {/* 원시 Content — ui/DialogContent 의 휴대폰 대화상자 규칙(가운데·max-height)을 피하고, 보이는 뷰포트(--vv-top·--vvh)에 붙인다
            (통합 검색 휴대폰 화면 SearchPalette 와 같은 방식). 설명 글이 없어 aria-describedby 를 비운다. */}
        <RawSheetContent
          data-testid="help-sheet"
          aria-describedby={undefined}
          className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--vvh,100dvh)] flex-col overflow-hidden bg-card pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <DialogPrimitive.Title className="sr-only">도움말</DialogPrimitive.Title>
          <LazyHelpPanel onAskAi={askAi} />
        </RawSheetContent>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
