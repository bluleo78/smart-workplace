// 매뉴얼 그림 지시문: 스크린샷을 이름 붙은 상자로 자르고 번호 표식을 얹는다.
import { esc } from './html.mjs';

// 원본 이미지는 그대로 두고 HTML/CSS 로만 자르므로(프레임 + 절대 위치 img) 캡처를 다시 찍어도 상자만 갱신하면 된다.

// 한 줄 전체가 그림 지시문인 줄. 그룹: 1=alt, 2=경로(shots/<book>/<id>.png), 3=파일명(id), 4=속성 블록(선택).
const FIGURE_RE = /^!\[([^\]]*)\]\((shots\/[^/)\s]+\/([^/)\s]+)\.png)\)(?:\{([^}]*)\})?\s*$/;

// 본문 단 폭을 꽉 채우는 자른 폭(원본 px). 집필 스킬의 가독성 기준(태스크 그림은 원본 1400px 이하)과 같은 값이다.
// 모든 그림을 같은 배율(원본 FULL_WIDTH_PX = 단 폭)로 인쇄해 화면 글자 크기를 그림마다 같게 맞춘다 —
// 좁게 자른 그림이 단 폭으로 확대돼 한 쪽을 차지하지 않게 하고, 더 넓은 그림은 단 폭에서 멈춘다.
export const FULL_WIDTH_PX = 1400;

// 번호 원을 상자 좌상단 바깥에 두려면 프레임 안에 필요한 여유(인쇄 CSS px): 원 지름 18 + 틈 2 (manual.css .mark 와 맞춘다).
const MARK_ROOM_CSS_PX = 20;
// 표식 여유 계산에 쓰는 보수적인 단 폭(인쇄 CSS px). 본문 단 자체는 A4 210mm - 좌우 여백 18mm x 2 = 174mm ≈ 657px(96dpi)
// 이지만, 그림이 「AI 와 함께」 절(.ai-with: 왼쪽 띠 4px + 좌우 안쪽 여백 약 1.1em)·인용문·번호 목록 안에 들어가면
// 그 여백만큼(약 30~40px) 좁아진다. 좁아지면 인쇄 배율이 작아져 같은 원본 px 여유로는 번호 원이 프레임에 잘리므로,
// 가장 좁은 경우를 덮도록 600px 로 계산한다(넓은 단에서는 번호가 안쪽으로 조금 더 자주 들어갈 뿐이다).
const MARK_COLUMN_CSS_PX = 600;

/** 번호 원 하나가 차지하는 자리(원본 px, 틈 포함). 인쇄 배율은 단 폭 / max(자른 폭, FULL_WIDTH_PX)이고, 단 폭은 좁은 컨테이너까지 덮는 보수값을 쓴다. */
export function markRoom(cropW) {
  return (MARK_ROOM_CSS_PX * Math.max(cropW, FULL_WIDTH_PX)) / MARK_COLUMN_CSS_PX;
}

// 번호 원을 둘 자리 후보 — 상자 바깥, 이 순서로 고른다. 위쪽 왼쪽이 기본이고, 세로로 촘촘히 쌓인 상자(레일 아이콘 등)는
// 위·아래 자리가 이웃과 겹쳐 옆 가운데(l·r)가 뽑힌다. 각 후보는 상자 기준 번호 원 사각형(원본 px)을 돌려준다.
const POSITIONS = {
  tl: (b, d) => ({ x: b.x - d, y: b.y - d }),
  l: (b, d) => ({ x: b.x - d, y: b.y + b.h / 2 - d / 2 }),
  tr: (b, d) => ({ x: b.x + b.w, y: b.y - d }),
  r: (b, d) => ({ x: b.x + b.w, y: b.y + b.h / 2 - d / 2 }),
  bl: (b, d) => ({ x: b.x - d, y: b.y + b.h }),
  br: (b, d) => ({ x: b.x + b.w, y: b.y + b.h }),
};
export const MARK_POSITIONS = Object.keys(POSITIONS);

// 두 사각형이 겹치는지(맞닿기만 하면 겹치지 않음).
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// a 가 b 를 완전히 감싸는지.
const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/**
 * 표식 항목을 나눈다. 'key' — 자리를 자동으로 고른다. 'key!inside' — 상자 안 오른쪽 위에 둔다.
 * 'key@r' 처럼 @자리를 붙이면 후보 순서와 상관없이 그 자리만 쓴다(그 자리도 프레임 안·겹침 없음 검사는 그대로 받는다) —
 * 자동으로 고른 자리가 표식 없는 화면 요소(머리말 아이콘 등)를 덮을 때 집필자가 고른다. flag 는 알 수 없는 옵션 보고용이다.
 */
export function parseMark(entry) {
  const at = entry.indexOf('@');
  if (at > 0) {
    const pos = entry.slice(at + 1);
    return { key: entry.slice(0, at), inside: false, pos, flag: MARK_POSITIONS.includes(pos) ? undefined : `@${pos}` };
  }
  const [key, flag] = entry.split('!');
  const inside = flag === 'inside';
  return { key, inside, pos: undefined, flag: flag === undefined || inside ? undefined : `!${flag}` };
}

/**
 * 그림의 번호 원 자리를 marks 순서대로 고른다 → [{ key, pos }] 또는 자리를 못 찾은 키에 { key, pos: null }.
 * 후보마다 (a) 번호 원 사각형이 자른 프레임 안에 들어가고 (b) 다른 표식 상자·이미 놓은 번호 원과 겹치지 않아야 한다.
 * 이 상자를 감싸는 다른 표식 상자(컨테이너)는 (b) 에서 뺀다 — 안쪽 상자의 번호는 어차피 그 컨테이너 안에 놓이기 때문이다.
 * 'key!inside' 는 바깥 자리를 찾지 않고 상자 안 오른쪽 위 모서리(pos 'in')에 둔다 — 앞쪽 아이콘·글자를 피하는 자리다.
 */
export function placeMarks(shot, marks, crop) {
  const d = markRoom(crop.w);
  const boxes = marks.map((m) => shot.boxes[parseMark(m).key]);
  const placed = [];
  return marks.map((m, i) => {
    const { key, inside, pos: wanted } = parseMark(m);
    const b = boxes[i];
    if (inside) {
      placed.push({ x: b.x + b.w - d, y: b.y, w: d, h: d });
      return { key, pos: 'in' };
    }
    const others = boxes.filter((o, j) => j !== i && !contains(o, b));
    for (const pos of wanted ? [wanted] : MARK_POSITIONS) {
      const r = { ...POSITIONS[pos](b, d), w: d, h: d };
      if (!contains(crop, r)) continue;
      if (others.some((o) => overlaps(o, r)) || placed.some((p) => overlaps(p, r))) continue;
      placed.push(r);
      return { key, pos };
    }
    return { key, pos: null };
  });
}

// 퍼센트 값을 소수 3자리로 반올림한다(HTML 이 불필요하게 길어지지 않게).
const pct = (v) => Math.round(v * 100 * 1000) / 1000;

// 한 줄을 파싱한다. 그림 줄이 아니면 null.
// crop 은 '+' 로 이은 키 목록(합집합), marks 는 ',' 로 이은 키 목록. 둘 다 생략 가능.
export function parseFigureLine(line) {
  const m = FIGURE_RE.exec(line);
  if (!m) return null;
  const attrs = {};
  for (const part of (m[4] ?? '').split(/\s+/).filter(Boolean)) {
    const eq = part.indexOf('=');
    const name = eq > 0 ? part.slice(0, eq) : part;
    // 오타(corp=a 등)가 조용히 무시되면 그림이 잘못 나가므로 알 수 없는 속성은 즉시 오류로 던진다.
    if (name !== 'crop' && name !== 'marks') {
      throw new Error(`알 수 없는 그림 속성: ${name} (줄: ${line})`);
    }
    attrs[name] = eq > 0 ? part.slice(eq + 1) : '';
  }
  const list = (v, sep) => (v ? v.split(sep).filter(Boolean) : []);
  return {
    alt: m[1],
    src: m[2],
    shotId: m[3],
    crop: list(attrs.crop, '+'),
    marks: list(attrs.marks, ','),
  };
}

// 상자 키를 찾는다. 모르는 키면 어떤 그림의 어떤 키인지 알 수 있게 `shotId:key` 로 던진다.
function boxOf(shot, shotId, key) {
  const box = shot.boxes?.[key];
  if (!box) throw new Error(`알 수 없는 상자 키: ${shotId}:${key}`);
  return box;
}

/** 여러 상자를 모두 감싸는 최소 상자(원본 px 기준 {x,y,w,h}). 자르기 영역과 촬영 표식(여러 로케이터)이 함께 쓴다. */
export function unionBoxes(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const btm = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

// 자르기 여백(원본 px). 표식 번호(지름 18px·2배 촬영)를 상자 바깥 모서리에 둘 자리가 남도록 48 로 둔다.
// 자른 폭이 FULL_WIDTH_PX 보다 넓으면 인쇄 배율이 작아져 번호 원 자리(markRoom)가 48 보다 커지므로, 그때는 여백을 그만큼 늘린다.
export const CROP_PAD_PX = 48;

// 자를 영역(원본 px) 계산: 지정한 상자들의 합집합에 pad 만큼 여백을 주고 원본 경계로 자른다.
// 키가 비면 전체 이미지. shotId 는 오류 메시지용(선택).
export function cropRect(shot, cropKeys, pad = CROP_PAD_PX, shotId = '?') {
  if (!cropKeys.length) return { x: 0, y: 0, w: shot.w, h: shot.h };
  const u = unionBoxes(cropKeys.map((key) => boxOf(shot, shotId, key)));
  // 여백이 넓어지면 자른 폭도 넓어져 번호 원 자리가 다시 커진다 — 몇 번 되풀이하면 멈춘다(폭 1px 당 1/30px 씩만 커진다).
  // 기본 여백(48)으로 충분한 좁은 자르기는 건드리지 않는다.
  for (let i = 0; i < 4; i++) {
    const need = Math.ceil(markRoom(u.w + 2 * pad));
    if (need > CROP_PAD_PX) pad = Math.max(pad, need);
  }
  const x1 = Math.max(0, u.x - pad);
  const y1 = Math.max(0, u.y - pad);
  const x2 = Math.min(shot.w, u.x + u.w + pad);
  const y2 = Math.min(shot.h, u.y + u.h + pad);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// 표식 상자가 자른 영역 안에 완전히 들어가는지.
const insideCrop = (b, c) => b.x >= c.x && b.y >= c.y && b.x + b.w <= c.x + c.w && b.y + b.h <= c.y + c.h;

/**
 * 그림 지시문 하나의 문제를 모두 모아 [{ kind, subject, message }] 로 돌려준다(빈 배열 = 통과).
 * 빌드(renderFigure)는 첫 message 를 던지고, 검사(check)는 kind 별 표지로 모두 보고한다 — 두 곳의 판정이 어긋나지 않게 한곳에 둔다.
 * - book: 경로의 shots/<book>/ 이 opts.book 과 다르다(opts.book 을 줄 때만)
 * - shot: boxes.json 에 그 샷이 없다(이후 검사는 할 수 없어 멈춘다)
 * - key: crop·marks 의 키가 그 샷에 없다(키마다 한 번)
 * - figure: 원본 크기(w/h)가 없다, 표식 상자가 자르기 영역 밖이다
 * subject 는 검사 출력에 쓰는 짧은 대상 표기, message 는 빌드 오류 문장이다.
 */
export function validateFigure(fig, boxesDoc, { book } = {}) {
  const problems = [];
  if (book && fig.src.split('/')[1] !== book) {
    const subject = `${fig.src} (검사 중인 책: ${book})`;
    problems.push({ kind: 'book', subject, message: `다른 책의 그림입니다: ${subject}` });
  }
  const shot = boxesDoc[fig.shotId];
  if (!shot) {
    problems.push({ kind: 'shot', subject: fig.shotId, message: `알 수 없는 그림: ${fig.shotId}` });
    return problems;
  }
  const badFlags = fig.marks.map(parseMark).filter((m) => m.flag !== undefined);
  for (const m of badFlags) {
    const message = `알 수 없는 표식 옵션: ${fig.shotId}:${m.key}${m.flag} (쓸 수 있는 것은 !inside, @${MARK_POSITIONS.join('|@')})`;
    problems.push({ kind: 'figure', subject: message, message });
  }
  if (badFlags.length) return problems;
  const markKeys = fig.marks.map((m) => parseMark(m).key);
  const unknownKeys = [...new Set([...fig.crop, ...markKeys])].filter((k) => !shot.boxes?.[k]);
  for (const k of unknownKeys) {
    const subject = `${fig.shotId}:${k}`;
    problems.push({ kind: 'key', subject, message: `알 수 없는 상자 키: ${subject}` });
  }
  if (unknownKeys.length) return problems;
  // 원본 크기가 없으면 자르기·퍼센트 계산이 NaN 이 되어 그림이 조용히 깨지므로 빌드·검사 모두 여기서 멈춘다.
  if (!(shot.w > 0 && shot.h > 0)) {
    const message = `그림 크기(w/h)가 없습니다: ${fig.shotId}`;
    problems.push({ kind: 'figure', subject: message, message });
    return problems;
  }
  // 표식 상자가 자른 영역 밖으로 나가면 프레임에서 잘려 보이므로 오류로 알린다.
  const c = cropRect(shot, fig.crop, CROP_PAD_PX, fig.shotId);
  const outside = markKeys.filter((key) => !insideCrop(shot.boxes[key], c));
  for (const key of outside) {
    const message = `표식 상자가 자르기 영역 밖입니다: ${fig.shotId}:${key} (outside the crop)`;
    problems.push({ kind: 'figure', subject: message, message });
  }
  if (outside.length) return problems;
  // 번호 원을 상자 바깥 어디에도 둘 수 없으면 조용히 안쪽에 넣지 않고 알린다 — 안쪽에 넣으면 가리키는 화면을 덮는다.
  for (const [i, { key, pos }] of placeMarks(shot, fig.marks, c).entries()) {
    if (pos) continue;
    const wanted = parseMark(fig.marks[i]).pos;
    if (wanted) {
      const message = `표식 번호를 ${key}@${wanted} 자리에 둘 수 없습니다: ${fig.shotId} — 그 자리가 자른 프레임 밖이거나 다른 표식과 겹칩니다`;
      problems.push({ kind: 'figure', subject: message, message });
      continue;
    }
    const message =
      `표식 번호를 둘 자리가 없습니다: ${fig.shotId}:${key} — 상자 바깥(위·옆·아래)에 번호가 들어갈 여백이 없거나 다른 표식과 겹칩니다. ` +
      `crop 에 이웃 상자를 더해 자르기를 넓히거나, 꼭 필요하면 marks 에 ${key}!inside 로 상자 안 오른쪽 위에 둡니다`;
    problems.push({ kind: 'figure', subject: message, message });
  }
  return problems;
}

// 그림 하나를 <figure class="shot"> HTML 로 만든다.
// 프레임은 자른 크기의 aspect-ratio, 안의 img 는 원본 크기를 퍼센트로 환산해 음수 오프셋으로 밀어 자른 효과를 낸다.
// 표식 상자·번호 위치는 자른 프레임 기준 퍼센트라 이미지와 정확히 겹친다. 번호는 marks 순서대로 1부터.
// figure 폭은 자른 폭에 비례(FULL_WIDTH_PX = 단 폭)해 모든 그림의 화면 글자가 같은 크기로 인쇄된다.
export function renderFigure(fig, boxesDoc) {
  const [problem] = validateFigure(fig, boxesDoc);
  if (problem) throw new Error(problem.message);
  const shot = boxesDoc[fig.shotId];
  const c = cropRect(shot, fig.crop, CROP_PAD_PX, fig.shotId);
  const imgStyle =
    `position:absolute;width:${pct(shot.w / c.w)}%;` +
    `left:${-pct(c.x / c.w)}%;top:${-pct(c.y / c.h)}%`;
  const marks = placeMarks(shot, fig.marks, c)
    .map(({ key, pos }, i) => {
      const b = shot.boxes[key]; // validateFigure 가 키·자르기·번호 자리를 확인했다
      const left = pct((b.x - c.x) / c.w);
      const top = pct((b.y - c.y) / c.h);
      const w = pct(b.w / c.w);
      const h = pct(b.h / c.h);
      // 번호 원은 상자 왼쪽 위 모서리를 기준점으로 놓고, 자리(data-pos)에 따라 CSS 가 상자 바깥(또는 !inside 면 안 오른쪽 위)으로 민다.
      // 기준점은 상자 왼쪽 위이고 상자 폭·높이는 CSS 변수로 넘겨 자리마다 같은 식으로 계산한다.
      return (
        `<span class="mark-box" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%"></span>` +
        `<span class="mark-anchor" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%">` +
        `<span class="mark" data-pos="${pos}">${i + 1}</span></span>`
      );
    })
    .join('');
  // 같은 배율로 인쇄: 자른 폭 / FULL_WIDTH_PX 만큼의 단 폭(최대 100%). 가운데 정렬은 CSS(figure.shot 의 auto 여백)가 한다.
  const figWidth = pct(Math.min(1, c.w / FULL_WIDTH_PX));
  return (
    `<figure class="shot" style="width:${figWidth}%">` +
    `<div class="shot-frame" style="aspect-ratio:${c.w} / ${c.h}">` +
    `<img src="${esc(fig.src)}" alt="${esc(fig.alt)}" style="${imgStyle}">${marks}</div>` +
    `<figcaption>${esc(fig.alt)}</figcaption></figure>`
  );
}
