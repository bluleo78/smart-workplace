// react-router 라우터 소스(App.tsx)에서 실제 페이지 경로를 뽑는다. TS 파서 의존성 없이 텍스트 스캔만 쓴다.
// 라우터는 JSX 라 `<Route ...>` 여는 태그 / `</Route>` / 자기 닫힘을 스택으로 따라가면 중첩 경로를 이을 수 있다.

/**
 * 주석 안의 `<Route` 를 라우트로 오인하지 않도록 주석을 지운다. 문자열 리터럴('…', "…", `…`) 안은 건드리지 않는다 —
 * `path="admin/*"` 의 `/*` 를 주석 시작으로 보면 뒤의 라우트가 통째로 사라지기 때문이다.
 * 블록 주석(JSX 의 `{/* *\/}` 안쪽 포함)과 줄 주석(`//` 부터 줄 끝, 줄바꿈은 남긴다)을 모두 지운다.
 * 정규식 리터럴·JSX 텍스트 속 따옴표는 구분하지 않는다 — 라우터 파일 대조용이라 그 정도면 충분하다.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      // 문자열은 같은 따옴표(역슬래시 이스케이프 제외)까지 그대로 옮긴다.
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i + 2);
      i = end < 0 ? src.length : end; // 줄바꿈은 남긴다
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// from 위치(`<Route` 시작)에서 태그 끝(`>`)을 찾는다. element={...} 안에는 `>` 가 있으므로 중괄호·따옴표 깊이를 센다.
function scanTag(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  throw new Error('닫히지 않은 <Route 태그');
}

// 태그 속성 문자열에서 path 와 element={...} 본문, index 여부를 읽는다.
function parseAttrs(tag) {
  // element={...} 값은 중괄호 깊이로 끝을 찾는다(탐욕 정규식은 뒤 속성의 마지막 } 까지 먹어 path 를 지운다).
  let element = '';
  let bare = tag;
  const ei = tag.search(/\belement=\{/);
  if (ei >= 0) {
    let i = tag.indexOf('{', ei);
    const start = i + 1;
    let depth = 0;
    for (; i < tag.length; i++) {
      if (tag[i] === '{') depth++;
      else if (tag[i] === '}' && --depth === 0) break;
    }
    element = tag.slice(start, i);
    // element 본문 안의 `path=`(예: 다른 컴포넌트 props)를 오인하지 않도록 본문을 지운 뒤 나머지 속성을 읽는다.
    bare = tag.slice(0, ei) + tag.slice(i + 1);
  }
  // path 를 큰따옴표 외 형태(path='..', path={..})로 쓰면 조용히 경로가 사라지므로 즉시 오류로 던진다.
  if (/\bpath=(?!")/.test(bare)) throw new Error(`<Route path> 는 큰따옴표 문자열이어야 합니다: <Route${tag.trim().slice(0, 80)}`);
  const pathM = /\bpath="([^"]*)"/.exec(bare);
  return { path: pathM ? pathM[1] : null, index: /\bindex\b/.test(bare), element };
}

// 부모 경로에 자식 path 를 잇는다. `/` 로 시작하면 절대 경로.
function join(parent, child) {
  if (child.startsWith('/')) return child;
  return `${parent === '/' ? '' : parent}/${child}`;
}

/**
 * 라우터 소스에서 { pages, redirects } 를 뽑는다.
 * - pages: path 또는 index 가 있는 라우트의 절대 경로와 element 최상위 컴포넌트 이름(경로 중복은 한 번만).
 * - redirects: element 안에 `<Navigate` 가 있거나 이름이 Redirect 로 끝나는 컴포넌트가 있는 경로.
 * 경로 없는 레이아웃 라우트는 부모 경로를 그대로 물려준다.
 */
export function extractRoutes(source) {
  const src = stripComments(source);
  const pages = [];
  const redirects = [];
  const seen = new Set();
  const stack = ['/']; // 현재 부모 경로. 맨 아래는 루트.
  const re = /<Route\b|<\/Route\s*>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('</')) {
      stack.pop();
      continue;
    }
    const end = scanTag(src, m.index);
    const tag = src.slice(m.index + m[0].length, end);
    const selfClosing = tag.trimEnd().endsWith('/');
    const { path: p, index, element } = parseAttrs(tag);
    const parent = stack[stack.length - 1];
    const full = p === null ? parent : join(parent, p);
    if (p !== null || index) {
      if (!seen.has(full)) {
        seen.add(full);
        const names = [...element.matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]);
        if (names.some((n) => n === 'Navigate' || n.endsWith('Redirect'))) redirects.push(full);
        else pages.push({ path: full, element: names[0] ?? '' });
      }
    }
    if (!selfClosing) stack.push(full);
    re.lastIndex = end;
  }
  return { pages, redirects };
}

/** 장 프론트매터 패턴이 실제 경로와 맞는지. `/x/**` 는 `/x` 와 그 아래 전부, 그 밖은 정확히 일치. */
export function matchRoute(pattern, routePath) {
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    return routePath === base || routePath.startsWith(`${base}/`);
  }
  return pattern === routePath;
}
