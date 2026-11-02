import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { useSecurityCheck } from '../../hooks/queries/useSecurityCheck'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { htmlHasScripts } from '../../lib/sandboxedHtml'
import { type SecurityChip, securityChip } from '../../lib/securityCheck'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { HighRiskScriptConfirm, ScriptControls, SecurityChipView } from './ScriptControls'

/**
 * HTML 파일 미리보기(드라이브·첨부 공용, WP-1260·WP-1262).
 *
 * - 기본은 스크립트 차단 격리 iframe 이다(#486·#732) — 받은 HTML 은 신뢰할 수 없다.
 * - 스크립트가 든 문서(발표 자료처럼 스크립트가 배치·이동을 맡는 문서)는 차단하면 모양이 무너지므로,
 *   「스크립트 실행」 스위치를 둔다 — 문서 영역에 안내 줄을 두지 않고, 데스크톱은 뷰어 머리줄에, 모바일은 문서 위에 떠 있는 묶음으로(WP-1282). 켜면 이 미리보기만 노트 HTML 블록(WP-1242)과 같은 격리
 *   (allowScripts — 불투명 출처라 앱 쿠키·저장소·화면에 닿지 못함, 대화상자 차단)로 다시 그린다.
 * - 허용은 그 문서에만 걸린다 — 허용한 문서 문자열을 기억해 두고 같을 때만 허용하므로, 같은 자리에서 내용이 바뀌어도(다시 받기)
 *   새 문서는 다시 차단된다. 뷰어가 항목마다 key 로 새로 붙여 다른 파일로 넘기거나 다시 열어도 차단으로 돌아간다.
 * - securityCheckPath 가 있으면 그 묶음에 AI 보안 점검 칩을 둔다(WP-1262). 점검이 안 끝났거나 실패해도 스위치는 늘 쓸 수 있다.
 *   AI 가 「높음」으로 본 문서는 켤 때 확인 창을 한 번 거친다.
 */
export function HtmlPreview({
  html,
  title,
  securityCheckPath,
  onOpenPanel,
  toolbarSlot,
}: {
  html: string
  title: string
  /** 보안 점검 조회·요청 경로 — 없으면(공개 공유 링크) 칩 없이 스위치만. */
  securityCheckPath?: string
  /** 결과 칩을 누르면 AI 패널을 연다. */
  onOpenPanel?: () => void
  /** 뷰어 머리줄의 컨트롤 자리(데스크톱) — 있으면 스크립트 컨트롤을 그리로 포털하고, 없으면 문서 위에 띄운다(WP-1282). */
  toolbarSlot?: HTMLElement | null
}) {
  // 수 MB 문서를 렌더마다 훑지 않게 문서가 바뀔 때만 판정한다.
  const hasScripts = useMemo(() => htmlHasScripts(html), [html])
  const [allowedHtml, setAllowedHtml] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const scriptsAllowed = allowedHtml === html
  const aiAvailable = useAiAvailable()
  const { view, pollingExhausted, request, requesting, errored } = useSecurityCheck(securityCheckPath, hasScripts)
  const chip = securityCheckPath
    ? securityChip(view, { pollingExhausted, requesting, aiAvailable, errored })
    : ({ kind: 'hidden' } as SecurityChip)
  const isHigh = view?.status === 'DONE' && view.risk === 'HIGH'
  // 실행 중이면 높음이어도 「스크립트 실행 중」(붉은 줄은 유지) — 아니면 높음일 때 AI 의 headline.
  const noticeText = scriptsAllowed ? '스크립트 실행 중' : isHigh && view?.headline ? view.headline : '이 문서에는 스크립트가 있어요'

  /** 스위치 — 끄기는 바로, 켜기는 AI 가 높음으로 본 문서만 확인 창을 거친다. */
  const toggle = (on: boolean) => {
    if (!on) setAllowedHtml(null)
    else if (isHigh) setConfirmOpen(true)
    else setAllowedHtml(html)
  }

  // 스크립트 컨트롤 묶음(점검 칩 + 실행 스위치) — 문서 영역에 한 줄을 차지하던 안내 줄을 없애고(WP-1282) 이 묶음만 둔다.
  // 데스크톱은 뷰어 머리줄 슬롯으로 포털해 파일 조작 아이콘 앞에 서고, 슬롯이 없으면(모바일) 문서 오른쪽 위에 떠 있다.
  const controls = hasScripts && (
    <ScriptControls
      floating={!toolbarSlot}
      high={isHigh}
      noticeText={noticeText}
      scriptsAllowed={scriptsAllowed}
      onToggle={toggle}
      security={<SecurityChipView chip={chip} view={view} onRequest={request} onOpenPanel={onOpenPanel} />}
    />
  )

  return (
    // 본문 영역 높이에 딱 맞춘다(WP-1282) — 예전 min-h-[60vh] 는 창이 낮을 때 본문 영역(overflow-auto)을 넘쳐
    // 바깥 스크롤바가 생겼다. 스크롤은 문서 iframe 안에서만 일어난다. relative = 떠 있는 컨트롤의 기준.
    <div className="relative flex h-full min-h-0 flex-col">
      {controls &&
        (toolbarSlot
          ? createPortal(
              <>
                {controls}
                {/* 머리줄의 파일 조작 아이콘과 가르는 세로 선 — 닫기 앞 구분선과 같은 모양. */}
                <div className="mx-1 h-5 w-px bg-border" aria-hidden />
              </>,
              toolbarSlot,
            )
          : controls)}
      <SandboxedHtmlFrame
        data-testid="html-document"
        title={title}
        html={html}
        allowScripts={scriptsAllowed}
        className="block min-h-0 w-full flex-1 border-0"
      />
      {/* 위험 문서 확인 — 미리보기와 노트 블록 공용 창(WP-1290). */}
      <HighRiskScriptConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        headline={view?.headline}
        fallbackHeadline="AI 가 이 문서의 스크립트를 위험하게 봤어요."
        scopeNote="이 미리보기에서만 실행되고, 앱의 로그인 정보와 데이터에는 닿지 못해요."
        onConfirm={() => setAllowedHtml(html)}
      />
    </div>
  )
}
