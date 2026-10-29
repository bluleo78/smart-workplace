// 매뉴얼 화면 촬영 도구: PNG 를 저장하고 UI 요소의 좌표를 boxes.json 에 기록한다.
// 순수 함수(toOriginalBox·clampBox)와 기록기는 브라우저 없이 시험한다(상자 합집합은 figure.mjs 의 unionBoxes 를 쓴다).
// Playwright 는 여기서 불러오지 않는다 — signIn 은 호출자가 띄운 browser 를 받는다.
import { access, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './books.mjs';
import { writeBoxesDoc } from './boxes-file.mjs';
import { unionBoxes } from './figure.mjs';

// 촬영 규격: 1440x810 뷰포트, 배율 2 → 원본 2880x1620 (docs/intro 소개서와 같다).
// 책 설정이 capture.viewport 를 주면 그 뷰포트로 찍는다(운영자 콘솔 — books.mjs 의 이유 참고). 배율은 같다.
const VIEWPORT = { width: 1440, height: 810 };

// 촬영 컨텍스트의 모든 문서에 넣는 스타일 — 찍을 때마다 달라지는 것을 없앤다.
// - 토스트(sonner)는 조작 결과 알림이라 있고 없고가 달라진다(두 앱 모두 sonner).
// - 애니메이션·전환을 0초로: 대화 창·메뉴가 등장 중일 때 재면 표식 상자가 작게 잡히고, 회전 표시는 찍는 순간마다 각도가 다르다.
const SHOT_STYLE = `
  [data-sonner-toaster] { display: none !important; }
  *, *::before, *::after {
    animation-duration: 0s !important; animation-delay: 0s !important;
    transition-duration: 0s !important; transition-delay: 0s !important;
  }
`;
const DPR = 2;

/** Playwright boundingBox(CSS px) 를 원본 px 로 환산하고 반올림한다. */
export function toOriginalBox(cssBox, dpr = DPR) {
  return {
    x: Math.round(cssBox.x * dpr),
    y: Math.round(cssBox.y * dpr),
    w: Math.round(cssBox.width * dpr),
    h: Math.round(cssBox.height * dpr),
  };
}

/**
 * 상자를 그림 경계 [0,w]×[0,h](원본 px) 안으로 자른다. 경계 밖으로 완전히 나가 남는 넓이가 없으면 null.
 * 화면 밖까지 이어진 요소(긴 목록 등)의 좌표를 그대로 두면 표식이 자르기 영역 밖이라는 빌드 오류가 나므로 기록할 때 자른다.
 */
export function clampBox(b, w, h) {
  const x1 = Math.max(0, b.x);
  const y1 = Math.max(0, b.y);
  const x2 = Math.min(w, b.x + b.w);
  const y2 = Math.min(h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * 장면이 만드는 그림 id 목록. 한 장면이 여러 그림을 찍으면 shots 로 밝힌다(예: 영구 삭제 확인 창 → 진행 배너 → 삭제됨 목록처럼
 * 앞 그림의 조작이 다음 그림의 전제인 경우 — 따로 떼면 한쪽만 다시 찍을 때 전제가 없다). 없으면 장면 id 하나다.
 */
function sceneShots(scene) {
  return scene.shots ?? [scene.id];
}

/** MANUAL_SHOTS_ONLY 에 적힌 id 중 어떤 장면도 찍지 않는 것(오타 등)을 돌려준다. 장면 id 와 장면이 밝힌 그림 id 를 모두 인정한다. */
export function unknownShotIds(only, scenes) {
  if (!only) return [];
  const known = new Set(scenes.flatMap((s) => [s.id, ...sceneShots(s)]));
  return [...only].filter((id) => !known.has(id));
}

/** MANUAL_SHOTS_ONLY 로 돌릴 장면을 고른다 — 장면 id 나 그 장면이 찍는 그림 id 가 하나라도 적혀 있으면 그 장면 전체를 돈다. only 가 없으면 전부. */
export function selectScenes(only, scenes) {
  if (!only) return scenes;
  return scenes.filter((s) => only.has(s.id) || sceneShots(s).some((id) => only.has(id)));
}

/**
 * 한 책의 촬영 기록기. shoot 는 PNG 를 쓰고 샷 크기를 남기며, mark 는 요소 좌표를 쌓고,
 * save 는 기존 boxes.json 과 샷 단위로 합쳐 쓴다(일부만 다시 찍어도 다른 샷 좌표가 유지된다).
 *
 * 장면 단위 확정: 좌표는 begin() 뒤 임시 영역에 쌓이고, PNG 는 `<id>.png.tmp` 로 찍힌다.
 * commit() 해야 좌표가 저장 대상이 되고 PNG 가 `<id>.png` 로 바뀐다. discard() 는 둘 다 버린다.
 * 실패한 장면이 그림만 새로 바꾸고 좌표는 예전 것으로 남기는(또는 그 반대) 조용한 불일치를 막으려는 것이다
 * (호출자: 성공 시 commit, 실패 시 discard).
 * dir 은 시험에서 임시 폴더를 쓰려고 둔 선택 인자다(기본: docs/manual/shots/<book>).
 * fs 는 commit 의 파일 이동(access·rename·rm)을 바꿔 끼우는 시험용 선택 인자다(이동 실패 되돌리기 시험).
 * viewport 는 shoot 전에 mark 한 상자를 자를 기본 그림 크기다(책 설정 capture.viewport, 없으면 1440x810).
 */
export function createShotRecorder({
  book,
  dpr = DPR,
  viewport = VIEWPORT,
  dir = path.join(ROOT, 'docs/manual/shots', book),
  fs = { access, rename, rm },
}) {
  const doc = {}; // 확정된 샷(save 가 쓰는 것)
  // 진행 중인 장면이 쌓는 샷: id → { shot: {w,h,boxes}, png: 임시 이름으로 찍었는지 }.
  let staged = new Map();
  const reset = () => {
    staged = new Map();
  };
  const stagedPngIds = () => [...staged].filter(([, s]) => s.png).map(([id]) => id);
  const pngPath = (id) => path.join(dir, `${id}.png`);
  const tmpPath = (id) => `${pngPath(id)}.tmp`;
  const bakPath = (id) => `${pngPath(id)}.bak`;
  // 임시 PNG 를 지우고 임시 영역을 비운다(begin·discard 공용).
  const drop = async () => {
    await Promise.all(stagedPngIds().map((id) => fs.rm(tmpPath(id), { force: true })));
    reset();
  };
  // 이번 장면에서 처음 만지는 샷은 빈 항목(책 뷰포트 크기)에서 시작한다 — 예전 확정본(이전 실행·앞 장면)을 이어 쓰지 않는다.
  // 그림을 새로 찍으면 상자도 이번에 찍은 것만 맞으므로, 예전 키·예전 w/h 가 섞여 들어오면 안 된다(commit 이 샷 단위로 덮어쓴다).
  const stage = (id) => {
    if (!staged.has(id)) {
      staged.set(id, { shot: { w: viewport.width * dpr, h: viewport.height * dpr, boxes: {} }, png: false });
    }
    return staged.get(id);
  };
  return {
    /** 새 장면을 시작한다. 앞 장면이 확정하지 않고 남긴 좌표·임시 PNG 는 버린다. */
    async begin() {
      await drop();
    },
    /**
     * 이번 장면의 PNG 를 제 이름으로 옮기고 좌표를 확정한다(샷 단위로 덮어쓴다).
     * 여러 그림을 한꺼번에 바꾸므로 중간에 이동이 실패해도 그림 일부만 바뀌지 않게 한다:
     * 1) 임시 파일이 모두 있는지 먼저 확인하고, 2) 예전 PNG 를 <id>.png.bak 로 옮겨 둔 뒤 새 PNG 를 들이고,
     * 3) 실패하면 들인 것을 지우고 .bak 을 되돌린 다음 오류를 다시 던진다(호출자가 discard 한다).
     * 좌표(doc)는 모든 이동이 성공한 뒤에만 확정한다.
     */
    async commit() {
      const ids = stagedPngIds();
      for (const id of ids) await fs.access(tmpPath(id));
      const backedUp = [];
      const moved = [];
      try {
        for (const id of ids) {
          try {
            await fs.rename(pngPath(id), bakPath(id));
            backedUp.push(id);
          } catch (e) {
            if (e.code !== 'ENOENT') throw e; // 처음 찍는 그림이면 예전 PNG 가 없다
          }
          await fs.rename(tmpPath(id), pngPath(id));
          moved.push(id);
        }
      } catch (e) {
        const rollbackErrors = [];
        for (const id of moved) await fs.rm(pngPath(id), { force: true }).catch((r) => rollbackErrors.push(r.message));
        for (const id of backedUp) await fs.rename(bakPath(id), pngPath(id)).catch((r) => rollbackErrors.push(r.message));
        // 되돌리기마저 실패하면 조용히 넘기지 않고 원래 오류에 덧붙인다(.bak 이 남아 있을 수 있다).
        if (rollbackErrors.length) e.message += ` (되돌리기 실패: ${rollbackErrors.join('; ')})`;
        throw e;
      }
      await Promise.all(backedUp.map((id) => fs.rm(bakPath(id), { force: true })));
      for (const [id, { shot }] of staged) doc[id] = shot;
      reset();
    },
    /** 이번 장면의 좌표와 임시 PNG 를 버린다(장면 실패 시) — 예전 PNG 는 그대로 남는다. */
    async discard() {
      await drop();
    },
    async shoot(page, id) {
      await mkdir(dir, { recursive: true });
      // 바로 <id>.png 에 쓰지 않는다: 장면이 끝까지 성공해야 commit 이 제 이름으로 옮긴다.
      // 입력 커서는 깜빡여 찍을 때마다 달라지므로 숨긴다(토스트·애니메이션은 컨텍스트 스타일이 이미 고정했다 — newShotContext).
      await page.screenshot({ path: tmpPath(id), type: 'png', caret: 'hide' });
      const s = stage(id);
      s.png = true;
      const vp = page.viewportSize();
      s.shot.w = vp.width * dpr;
      s.shot.h = vp.height * dpr;
      console.log(`  ${id}.png`);
    },
    /**
     * 로케이터(여럿이면 합집합)의 위치를 기록한다. 화면에 없으면 오류 — 조용히 빠뜨리지 않는다.
     * 좌표는 그림(뷰포트) 경계로 자른다. 잘라서 남는 것이 없으면(완전히 화면 밖) 역시 화면에 없는 것으로 본다.
     */
    async mark(id, key, ...locators) {
      const missing = () => new Error(`${id}:${key} 표시 대상이 화면에 없다`);
      // 없는 요소는 기본 30초를 기다리지 않고 3초 안에 같은 메시지로 실패시킨다.
      const found = await Promise.all(locators.map((l) => l.first().boundingBox({ timeout: 3000 }).catch(() => null)));
      if (found.length === 0 || found.some((b) => !b)) throw missing();
      const { shot } = stage(id);
      const boxes = found.map((b) => clampBox(toOriginalBox(b, dpr), shot.w, shot.h));
      if (boxes.some((b) => !b)) throw missing();
      shot.boxes[key] = boxes.length === 1 ? boxes[0] : unionBoxes(boxes);
    },
    /**
     * 확정된 샷만 기존 boxes.json 과 합쳐 쓴다. 확정된 것이 없으면 파일을 건드리지 않는다.
     * 기존 파일이 깨져 있으면 던진다(빈 문서로 덮어써 다른 샷 좌표를 지우지 않게).
     */
    async save() {
      if (Object.keys(doc).length === 0) return;
      await writeBoxesDoc(path.join(dir, 'boxes.json'), doc);
    },
  };
}

/**
 * 촬영 규격(뷰포트·배율·로케일·시간대·라이트 테마 고정)의 새 브라우저 컨텍스트를 만든다. 모든 문서에 SHOT_STYLE 을 넣는다.
 * 로그인 장면처럼 로그아웃 상태의 화면을 찍을 때 장면이 page.context().browser() 로 따로 연다(공유 페이지를 로그아웃시키지 않게).
 * viewport 는 책 설정 capture.viewport(없으면 1440x810).
 */
export async function newShotContext(browser, viewport = VIEWPORT) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: DPR,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
  });
  // 문서가 만들어질 때마다(이동·새로 고침 포함) 스타일을 넣는다. 초기화 스크립트가 도는 시점엔 문서 요소가 아직 없으므로
  // 문서를 다 읽은 뒤(DOMContentLoaded) 붙인다 — 앱 화면은 그 뒤에 그려지므로 처음부터 적용된다.
  await context.addInitScript((css) => {
    // 매뉴얼 그림은 라이트 테마만 싣는다 — 장면이 테마를 바꿔도 다음 문서부터 다시 라이트로 돌린다(next-themes 저장 키 'theme').
    try {
      localStorage.setItem('theme', 'light');
    } catch {
      // about:blank 처럼 저장소가 없는 문서는 건너뛴다
    }
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    });
  }, SHOT_STYLE);
  return context;
}

/**
 * 로그인 화면을 거쳐 로그인된 컨텍스트를 돌려준다.
 * access token 이 메모리에만 있어 저장소 주입으로는 흉내 낼 수 없다(소개서 촬영과 같은 이유).
 * usernameSelector 는 로그인 화면의 아이디 칸 CSS 선택자로, 책 설정(BOOKS.<book>.capture.usernameSelector)에서 받는다.
 * 비밀번호 칸·제출 단추는 두 앱이 같은 마크업(input[type=password], button[type=submit])이다.
 * 비밀번호는 로그에 남기지 않는다.
 */
export async function signIn(browser, { web, username, password, usernameSelector, viewport }) {
  const context = await newShotContext(browser, viewport);
  const page = await context.newPage();
  await page.goto(`${web}/login`);
  await page.locator(usernameSelector).fill(username);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  // 로그인한 페이지는 닫지 않는다 — access token 이 이 페이지 메모리에만 있다. 장면은 context.pages()[0] 를 쓴다.
  return context;
}
