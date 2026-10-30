// 촬영 장면 공용 도구(사용자·운영자 장면이 함께 쓴다). Playwright 로케이터만 다루고 브라우저를 띄우지 않는다.
//   - capture: 그림 한 장을 찍고 표식 좌표를 기록한다
//   - dialog·openDialog·closeDialog: 대화 창을 열고, 제출하지 않고 닫는다

/**
 * 그림 한 장을 찍는다 — 마우스를 구석으로 옮기고(hover 강조 제거), marks 를 적은 순서대로 기록한 뒤 저장한다.
 * 네 번째 인자 { pad } 는 상자 여백(CSS px)이다.
 * marks 는 { 키: 로케이터 | [로케이터...] }. 배열이면 합집합 상자다. 적은 순서가 boxes.json 의 키 순서가 된다.
 */
export async function capture(page, rec, id, marks, { pad } = {}) {
  await page.mouse.move(0, 0);
  // pad(CSS px)를 주면 모든 상자를 그만큼 넓힌다(rec.mark 주석 — 테두리가 글자를 자르지 않게).
  // 값이 배열이고 마지막이 { pad } 객체면 그 키만 그 여백을 쓴다(전체 pad 보다 우선).
  for (const [key, loc] of Object.entries(marks)) {
    const args = [loc].flat();
    const own = args.length > 1 && typeof args.at(-1)?.first !== 'function';
    await rec.mark(id, key, ...args, ...(own || !pad ? [] : [{ pad }]));
  }
  await rec.shoot(page, id);
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
 * extraBlock(url) 이 true 인 GET 도 막는다(예: AI 를 부르는 채널 캐치업 요약). 막은 요청은 blocked 배열에 쌓아 호출자가 보고한다.
 * 같은 컨텍스트에 두 번 걸지 않는다(WeakSet).
 */
const guarded = new WeakSet();
export const blockedRequests = [];
export async function guardReadOnly(context, { extraBlock = () => false } = {}) {
  if (guarded.has(context)) return;
  guarded.add(context);
  await context.route('**/api/**', (route) => {
    const req = route.request();
    const url = req.url();
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method());
    if ((safe && !extraBlock(url)) || /\/api\/v1\/auth\//.test(url)) return route.fallback();
    blockedRequests.push(`${req.method()} ${new URL(url).pathname}`);
    return route.abort('blockedbyclient');
  });
}
