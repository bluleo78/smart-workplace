// 촬영 장면 공용 도구(사용자·운영자 장면이 함께 쓴다). Playwright 로케이터만 다루고 브라우저를 띄우지 않는다.
//   - capture: 그림 한 장을 찍고 표식 좌표를 기록한다
//   - dialog·openDialog·closeDialog: 대화 창을 열고, 제출하지 않고 닫는다

/** 장면이 여는 웹 주소(capture.mjs 가 촬영 전에 있는지 확인한다). */
export const WEB = () => process.env.MANUAL_WEB;

/** data-testid 로케이터. */
export const byTestId = (page, id) => page.getByTestId(id);

/** 표식 상자를 글자에서 띄우는 기본 여백(CSS px, 원본 8px) — 글자 요소의 상자가 글자에 딱 붙거나 좁아 테두리가 글자를 자르거나 덮었다. */
export const MARK_PAD = 4;

/** 글꼴을 다 읽을 때까지 기다린다(글꼴이 늦게 바뀌면 글자 폭·상자가 달라진다). */
export const fontsReady = (page) => page.evaluate(() => document.fonts.ready);

/** 포커스된 요소의 포커스를 푼다(입력 칸 포커스 테두리·선택된 글자가 찍히지 않게). */
export const blurActive = (page) =>
  page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

/**
 * readFn() 의 값이 0.5초 간격으로 두 번 연속 같아질 때까지(최대 10번) 기다린다 — 늦게 붙는 배지·아이콘이 찍힐 때마다 달라지지 않게.
 */
export async function settleStable(page, readFn) {
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const cur = await readFn();
    if (cur === prev) return;
    prev = cur;
    await page.waitForTimeout(500);
  }
}

/**
 * 그림 한 장을 찍는다 — 마우스를 구석으로 옮기고(hover 강조 제거), 글꼴을 기다리고, marks 를 적은 순서대로 기록한 뒤 저장한다.
 * marks 는 { 키: 로케이터 | [로케이터...] | { at: 로케이터 | [로케이터...], pad: 숫자 } }. 배열이면 합집합 상자다.
 * { at, pad } 로 적은 키는 그 여백(CSS px, 음수면 줄임)을 쓴다. 적은 순서가 boxes.json 의 키 순서가 된다.
 * 옵션 pad 는 나머지 키의 여백(기본 MARK_PAD — 01~03장·운영자 책처럼 여백 없이 검수한 그림은 { pad: 0 }),
 * redact 는 그 키들의 자르기 영역 밖을 가리고 찍는다(capture-kit 의 shoot 주석).
 */
export async function capture(page, rec, id, marks, { pad = MARK_PAD, redact } = {}) {
  await page.mouse.move(0, 0);
  await fontsReady(page);
  for (const [key, spec] of Object.entries(marks)) {
    const own = !Array.isArray(spec) && spec.at !== undefined;
    await rec.mark(id, key, own ? spec.at : spec, { pad: own ? spec.pad : pad });
  }
  await rec.shoot(page, id, { redact });
}

/** 열린 대화 창(일반·확인 창 공용) — 여러 개면 마지막에 열린 것. */
export const dialog = (page) => page.locator('[role=dialog], [role=alertdialog]').last();

/** 여는 단추(data-testid)를 눌러 대화 창을 열고, 창이 나타나면 그 창을 돌려준다. */
export async function openDialog(page, openerTestId) {
  await page.getByTestId(openerTestId).click();
  const d = dialog(page);
  await d.waitFor();
  return d;
}

/** 대화 창을 제출·확정하지 않고 닫는다. */
export const closeDialog = (page) => page.keyboard.press('Escape');

/**
 * 읽기만 하는 브라우저 컨텍스트로 만든다 — /api/ 로 가는 GET·HEAD·OPTIONS 이외 요청을 브라우저 안에서 막는다(서버에 닿지 않는다).
 * 운영 테넌트에서 찍는 사용자 매뉴얼용이다: 채널을 열기만 해도 앱이 읽음 처리(POST …/read)를 보내고, 스레드 패널은 스레드 읽음을
 * 보낸다. 막지 않으면 다음 촬영의 안 읽음 수(레일 배지·홈 숫자)가 바뀐다. 로그인 유지(토큰 갱신)에 쓰는 /auth/ 만 통과시킨다.
 *
 * 규칙은 컨텍스트마다 객체 하나로 두고 route 처리기는 요청마다 그 객체를 읽는다 — 그래서 어느 장면이 먼저 돌았는지와 상관없이
 * 지금 장면이 건 규칙이 적용된다(예전에는 컨텍스트의 첫 호출 규칙만 남아 실행 순서에 따라 결과가 달랐다).
 *   - extraBlock(url): true 인 GET 도 막는다(예: AI 를 부르는 채널 캐치업 요약). 다시 주면 바꾼다(화면 여는 도우미가 매번 같은 값을 준다).
 *   - allowRead(url): extraBlock 에 걸린 GET 중 이 장면만 열어 둘 것(예: 놓친 대화 요약 장면의 GET …/catchup). 장면 안에서 쌓인다.
 *   - allowWrite(method, url): 통과시킬 쓰기. 데이터를 새로 만들거나 바꾸지 않는다고 서버 코드로 확인한 요청이나 once 장면의 AI 요청에만
 *     쓴다(예: 채널 드라이브 열기 POST …/drive-space — 공간이 이미 있으면 같은 값으로 멤버를 맞추기만 한다). 장면 안에서 쌓인다.
 * 장면이 끝나면 촬영기(capture.mjs)가 resetGuard 로 장면이 연 허용(allowRead·allowWrite)을 걷는다. extraBlock 은 남긴다 —
 * 화면 여는 도우미를 거치지 않는 장면이 AI 를 부르는 GET 을 흘려보내지 않게(차단을 줄이는 쪽으로는 되돌리지 않는다).
 * 막은 요청은 blockedRequests 에 쌓이며, 촬영기가 장면마다 비우고 장면 끝에 출력한다.
 */
const guards = new WeakMap();
export const blockedRequests = [];
const defaultRules = () => ({ extraBlock: () => false, allowRead: [], allowWrite: [] });

export async function guardReadOnly(context, { extraBlock, allowRead, allowWrite } = {}) {
  if (!guards.has(context)) {
    guards.set(context, defaultRules());
    await context.route('**/api/**', (route) => {
      const rules = guards.get(context);
      const req = route.request();
      const url = req.url();
      const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method());
      if (/\/api\/v1\/auth\//.test(url)) return route.fallback();
      if (safe && (!rules.extraBlock(url) || rules.allowRead.some((allow) => allow(url)))) return route.fallback();
      if (!safe && rules.allowWrite.some((allow) => allow(req.method(), url))) return route.fallback();
      blockedRequests.push(`${req.method()} ${new URL(url).pathname}`);
      return route.abort('blockedbyclient');
    });
  }
  const rules = guards.get(context);
  if (extraBlock) rules.extraBlock = extraBlock;
  if (allowRead) rules.allowRead.push(allowRead);
  if (allowWrite) rules.allowWrite.push(allowWrite);
}

/** 장면이 연 허용(allowRead·allowWrite)을 걷는다 — 모든 쓰기를 다시 막는다. extraBlock 은 그대로 둔다. 가드를 건 적 없는 컨텍스트면 아무것도 하지 않는다. */
export function resetGuard(context) {
  const rules = guards.get(context);
  if (!rules) return;
  rules.allowRead = [];
  rules.allowWrite = [];
}
