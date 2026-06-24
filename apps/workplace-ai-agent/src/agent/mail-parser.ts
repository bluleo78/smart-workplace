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

/** 코칭 평가 차원 화이트리스트. */
const COACHING_DIMENSIONS = ['TONE', 'CLARITY', 'COMPLETENESS'];

/**
 * 초안 코칭 JSON 파싱: {notes:[{dimension,message}], improvedBodyHtml}.
 * 알 수 없는 dimension 노트는 (유효 JSON 안에서만) 제외한다.
 * ⚠️ JSON 이 없거나 깨졌으면 throw — 빈 결과로 폴백하면 "고칠 곳 없어요"라는 거짓 신호가 되므로
 * 호출부(러너→라우트)가 502 로 전파하고 프론트는 에러 UI 를 띄운다.
 */
export function parseDraftCoachingJson(text: string): {
  notes: { dimension: string; message: string }[];
  improvedBodyHtml: string;
} {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`코칭 JSON 없음: ${text.slice(0, 120)}`);
  // JSON.parse 실패 시 그대로 throw (폴백 금지).
  const obj = JSON.parse(m[0]) as { notes?: unknown; improvedBodyHtml?: unknown };
  const rawNotes = Array.isArray(obj.notes) ? obj.notes : [];
  const notes = rawNotes
    .map((n) => n as { dimension?: unknown; message?: unknown })
    .filter(
      (n) =>
        typeof n.dimension === 'string' &&
        COACHING_DIMENSIONS.includes(n.dimension) &&
        typeof n.message === 'string' &&
        n.message.length > 0,
    )
    .map((n) => ({ dimension: n.dimension as string, message: n.message as string }));
  const improvedBodyHtml = typeof obj.improvedBodyHtml === 'string' ? obj.improvedBodyHtml : '';
  return { notes, improvedBodyHtml };
}
