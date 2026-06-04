// 7d: CLI stream-json 라인 → 최종 텍스트, 그리고 분류 JSON 파싱.
export function extractResultText(lines: string[]): string {
  let result: string | null = null;
  const textParts: string[] = [];
  for (const line of lines) {
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    const obj = ev as { type?: string; result?: unknown; message?: { content?: unknown } };
    if (obj.type === 'result' && typeof obj.result === 'string') result = obj.result;
    else if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const raw of obj.message.content as Array<{ type?: string; text?: string }>) {
        if (raw?.type === 'text' && typeof raw.text === 'string' && raw.text.trim()) textParts.push(raw.text.trim());
      }
    }
  }
  return (result ?? textParts.join('\n')).trim();
}

const CATEGORIES = ['업무', '개인', '알림', '프로모션', '뉴스레터'];

// 모델이 코드펜스/잡설을 섞어도 첫 JSON 객체만 파싱. 카테고리 검증(미지 → 업무 폴백).
export function parseClassifyJson(text: string): { category: string; needsReply: boolean } {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error(`분류 JSON 없음: ${text.slice(0, 120)}`);
  const obj = JSON.parse(m[0]) as { category?: unknown; needsReply?: unknown };
  const category = typeof obj.category === 'string' && CATEGORIES.includes(obj.category) ? obj.category : '업무';
  return { category, needsReply: obj.needsReply === true };
}
