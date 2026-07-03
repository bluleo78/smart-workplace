// 7d: 분류/코칭 등 JSON 파싱 유틸.
// ⚠️ 과거 CLI stream-json 라인 → 최종 텍스트 추출은 `extractResultText` 가 맡았으나,
// collect 경로가 AgentRunner(Task 5)로 이관되며 provider-neutral `finalText`(runner-events.ts)
// 로 대체됐다(의미 동일: result.text 우선, 없으면 assistant_text join). 이 함수는 제거.

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

// #520 메일→이슈 초안 JSON 파싱. 코드펜스 제거 후 JSON.parse. 실패 시 throw(빈 폴백 금지 — 거짓 성공 신호 방지).
export function parseIssueDraftJson(text: string): {
  title: string;
  body: string;
  priority: string;
  projectKey?: string;
} {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const obj = JSON.parse(cleaned) as Record<string, unknown>;
  const title = String(obj.title ?? '').trim();
  const body = String(obj.body ?? '').trim();
  if (!title) throw new Error('issue-draft: title 누락');
  const rawPriority = String(obj.priority ?? 'MID').toUpperCase();
  const priority = ['LOW', 'MID', 'HIGH'].includes(rawPriority) ? rawPriority : 'MID';
  const projectKey =
    typeof obj.projectKey === 'string' && obj.projectKey.trim() ? obj.projectKey.trim() : undefined;
  return { title, body, priority, projectKey };
}
