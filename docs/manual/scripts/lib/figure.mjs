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

/**
 * 표식 번호를 상자 안쪽에 둬야 하는지. 상자 왼쪽·위쪽과 프레임 가장자리 사이(원본 px)가 번호 원이 들어갈 여유보다 작으면
 * 바깥에 두면 프레임(overflow:hidden)에 잘리므로 안쪽에 둔다. 인쇄 배율은 단 폭 / max(자른 폭, FULL_WIDTH_PX)이며,
 * 단 폭은 좁은 컨테이너까지 덮는 보수값(MARK_COLUMN_CSS_PX)을 쓴다.
 */
export function markInside(box, crop) {
  const roomOrig = (MARK_ROOM_CSS_PX * Math.max(crop.w, FULL_WIDTH_PX)) / MARK_COLUMN_CSS_PX;
  return box.x - crop.x < roomOrig || box.y - crop.y < roomOrig;
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
export const CROP_PAD_PX = 48;

// 자를 영역(원본 px) 계산: 지정한 상자들의 합집합에 pad 만큼 여백을 주고 원본 경계로 자른다.
// 키가 비면 전체 이미지. shotId 는 오류 메시지용(선택).
export function cropRect(shot, cropKeys, pad = CROP_PAD_PX, shotId = '?') {
  if (!cropKeys.length) return { x: 0, y: 0, w: shot.w, h: shot.h };
  const u = unionBoxes(cropKeys.map((key) => boxOf(shot, shotId, key)));
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
  const unknownKeys = [...new Set([...fig.crop, ...fig.marks])].filter((k) => !shot.boxes?.[k]);
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
  for (const key of fig.marks) {
    if (insideCrop(shot.boxes[key], c)) continue;
    const message = `표식 상자가 자르기 영역 밖입니다: ${fig.shotId}:${key} (outside the crop)`;
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
  const marks = fig.marks
    .map((key, i) => {
      const b = shot.boxes[key]; // validateFigure 가 키와 자르기 영역 안을 확인했다
      const left = pct((b.x - c.x) / c.w);
      const top = pct((b.y - c.y) / c.h);
      const w = pct(b.w / c.w);
      const h = pct(b.h / c.h);
      // 번호는 기본적으로 상자 좌상단 바깥에 두어 상자 안 화면 글자를 가리지 않는다(CSS .mark).
      // 상자가 프레임 위·왼쪽 가장자리에 가까워 바깥 자리가 없으면 data-inside 로 안쪽에 둔다(프레임 밖으로 잘리지 않게).
      const inside = markInside(b, c) ? ' data-inside' : '';
      return (
        `<span class="mark-box" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%"></span>` +
        `<span class="mark"${inside} style="left:${left}%;top:${top}%">${i + 1}</span>`
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
