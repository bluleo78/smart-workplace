// WP-1375: 지시문·user message 에 글을 싣을 때 쓰는 작은 글 다듬기 도우미.
// chat-user-message.ts 가 user-message.ts(→ mcp/tools 를 끌어온다)를 import 하지 않도록 따로 둔다.

// 앞 max 글자(UTF-16 단위)만 남긴다. 자르는 자리가 서로게이트 쌍 가운데면 그 쌍 앞에서 자른다(깨진 글자를 남기지 않게) — API 의 Texts.headUtf16 과 같은 규칙.
export function headUtf16(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = max;
  if (s.charCodeAt(cut - 1) >= 0xd800 && s.charCodeAt(cut - 1) <= 0xdbff) cut -= 1;
  return s.slice(0, cut);
}

// 글을 max 자로 자르고 넘었으면 「…」를 붙인다(「…」는 max 밖). 서로게이트 쌍은 쪼개지 않는다.
export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${headUtf16(s, max)}…`;
}

// KST(+9h) 환산 공통 코어 — 절대 시각(UTC Z 든 +09:00 든)을 한국 시각의 날짜·시각·요일 번호(0=일)로 쪼갠다. 읽을 수 없으면 null.
// 서버 시간대와 무관하게 +9시간 산술로만 계산한다.
export function kstParts(iso: string): { date: string; time: string; weekday: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    weekday: d.getUTCDay(),
  };
}

// 이슈챗 글 시각용 "yyyy-MM-dd HH:mm"(KST, 요일 없음). 읽을 수 없으면 원문.
export function formatKstShort(iso: string): string {
  const k = kstParts(iso);
  return k ? `${k.date} ${k.time}` : iso;
}

// 글쓴이 이름 한 줄로 — 이름 속 줄바꿈(\r·\n·U+2028/2029/0085, 둘레 공백 포함)을 공백 하나로 바꾸고, 이름에 넣은
// 「(맡긴 사람)」 글자를 지워 이름으로 가짜 줄·절 제목이나 맡긴 사람 표시를 흉내 내지 못하게 한다.
export function oneLine(s: string): string {
  return s
    .replace(/\s*[\r\n\u2028\u2029\u0085]+\s*/g, ' ')
    .replace(/\(\s*맡긴\s*사람\s*\)/g, '')
    .trim();
}
