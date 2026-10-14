// 이슈 챗 작성창 안내(WP-373 §5.2) — 외부 실행 AI 가 담당한 이슈에서 사람이 멘션 없이 답해도 그 AI 가 읽고 이어 간다는 것을 알린다.
import { iGa } from '@/lib/utils'

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3

/** 이름 뒤 주격 조사 — 한글 음절로 끝나면 받침에 따라 이/가, 아니면 「이(가)」. */
function subjectParticle(name: string): string {
  const code = name.charCodeAt(name.length - 1)
  return code >= HANGUL_FIRST && code <= HANGUL_LAST ? iGa(name) : '이(가)'
}

/** 외부 실행 AI 이름 → 작성창 안내. 이름이 없으면 undefined(기본 안내를 쓴다). */
export function agentReplyHint(name: string | null | undefined): string | undefined {
  const n = name?.trim()
  if (!n) return undefined
  return `답변 입력… 멘션 없이 보내도 ${n}${subjectParticle(n)} 이어받아요`
}
