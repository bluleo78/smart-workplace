// 매뉴얼 화면 촬영 도구: PNG 를 저장하고 UI 요소의 좌표를 boxes.json 에 기록한다.
// 순수 함수(toOriginalBox·clampBox)와 기록기는 브라우저 없이 시험한다(상자 합집합은 figure.mjs 의 unionBoxes 를 쓴다).
// Playwright 는 여기서 불러오지 않는다 — signIn 은 호출자가 띄운 browser 를 받는다.
import { access, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './books.mjs';
import { writeBoxesDoc } from './boxes-file.mjs';
import { unionBoxes } from './figure.mjs';

// 촬영 규격: 1440x810 뷰포트, 배율 2 → 원본 2880x1620 (docs/intro 소개서와 같다).
const VIEWPORT = { width: 1440, height: 810 };
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

/** MANUAL_SHOTS_ONLY 에 적힌 id 중 장면이 없는 것(오타 등)을 돌려준다. only 가 없으면 빈 배열. */
export function unknownShotIds(only, scenes) {
  if (!only) return [];
  const known = new Set(scenes.map((s) => s.id));
  return [...only].filter((id) => !known.has(id));
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
 */
export function createShotRecorder({
  book,
  dpr = DPR,
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
  // 이번 장면에서 처음 만지는 샷은 확정본을 복제해 시작한다 — 앞 장면이 확정한 상자를 이어 쓰되,
  // 실패해 버릴 때 확정본이 함께 바뀌지 않도록 참조가 아닌 복사본을 쓴다.
  const stage = (id) => {
    if (!staged.has(id)) {
      const shot = doc[id]
        ? structuredClone(doc[id])
        : { w: VIEWPORT.width * dpr, h: VIEWPORT.height * dpr, boxes: {} };
      staged.set(id, { shot, png: false });
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
      await page.screenshot({ path: tmpPath(id), type: 'png' });
      const s = stage(id);
      s.png = true;
      const vp = page.viewportSize() ?? VIEWPORT;
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
 * 로그인 화면을 거쳐 로그인된 컨텍스트를 돌려준다.
 * access token 이 메모리에만 있어 저장소 주입으로는 흉내 낼 수 없다(소개서 촬영과 같은 이유).
 * 비밀번호는 로그에 남기지 않는다.
 */
export async function signIn(browser, { web, username, password }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.goto(`${web}/login`);
  await page.getByPlaceholder('아이디를 입력하세요').fill(username);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  // 로그인한 페이지는 닫지 않는다 — access token 이 이 페이지 메모리에만 있다. 장면은 context.pages()[0] 를 쓴다.
  return context;
}
