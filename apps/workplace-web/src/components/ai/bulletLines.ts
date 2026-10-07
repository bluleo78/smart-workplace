/**
 * AI 요약 텍스트가 `• ` 목록(한 줄에 한 항목)이면 기호를 뗀 항목 배열을, 아니면 null 을 돌려준다.
 * 목록이면 <ul> 로 그려 줄바꿈된 긴 항목도 기호 뒤로 들여쓰고(hanging indent) 스크린리더에 목록으로 읽히게 하고,
 * 목록이 아니면(옛 문단형·모델이 형식을 안 따른 경우) 원문을 그대로 보이게 하기 위함이다.
 */
export function bulletLines(text: string): string[] | null {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0 || !lines.every((line) => line.startsWith('• '))) return null
  return lines.map((line) => line.slice(2).trim())
}
