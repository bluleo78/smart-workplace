// 메일 AI 요약 표시 보조(WP-400).

/**
 * AI 요약 첫 줄(불릿 기호 제거) — 모바일에서 접힌 요약 카드의 한 줄 미리보기. 요약은 "• 나에게: …\n• 핵심: …" 형태다.
 * 글자가 없으면(공백·불릿 기호뿐) null — 미리보기 자리에 빈 칸을 그리지 않게.
 */
export function firstSummaryLine(summary: string): string | null {
  for (const l of summary.split('\n')) {
    const text = l.replace(/^\s*[•\-*·]\s*/, '').trim()
    if (text) return text
  }
  return null
}
