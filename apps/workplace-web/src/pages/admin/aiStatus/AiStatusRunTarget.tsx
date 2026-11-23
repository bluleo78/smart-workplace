// 처리 대상 표시(WP-1825) — 이슈면 상세로 가는 링크, 그 밖(메일·파일 등)은 글자만. 표·카드·시트가 함께 쓴다.
import { Link } from 'react-router-dom'

import type { AiRunTarget } from '@/api/aiStatus'

import { targetHref, targetText } from './aiStatusHistoryModel'

/** 처리 대상 — 링크는 행·카드 누름(상세 열기)과 따로 이동하도록 전파를 막는다. */
export function AiStatusRunTarget({ target }: { target: AiRunTarget | null }) {
  const href = targetHref(target)
  const text = targetText(target)
  if (!href) return <>{text}</>
  return (
    <Link to={href} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
      {text}
    </Link>
  )
}
