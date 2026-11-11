// 매뉴얼 명령줄 스크립트 공용 도구: 책별 검사 실행기와 Playwright 불러오기·페이지 그림 준비 대기.
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './books.mjs';

/**
 * 책마다 checkBook(book) → { lines, errors } 를 돌려 출력하고, 오류가 하나라도 있으면 exit 1, 없으면 exit 0.
 * 검사(check)·산문 검사(prose)가 같은 흐름이라 한곳에 둔다.
 */
export async function runBooks(books, checkBook) {
  let failed = false;
  for (const book of books) {
    const { lines, errors } = await checkBook(book);
    console.log(lines.join('\n'));
    if (errors > 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Playwright chromium 을 불러온다. 저장소 루트에는 playwright 가 없으므로 workplace-web 의 의존성을 빌려 쓴다.
 * 브라우저가 필요할 때만 부르도록 함수로 둔다(촬영 장면이 없으면 불러오지 않는다).
 */
export function loadChromium() {
  const require = createRequire(path.join(ROOT, 'apps/workplace-web/package.json'));
  return require('@playwright/test').chromium;
}

/**
 * 연 페이지의 웹폰트·이미지 디코딩이 끝나기를 기다리고, 불러오지 못한(깨진) 이미지의 src 목록을 돌려준다(빈 배열 = 모두 성공).
 * 폰트·이미지가 다 준비돼야 PDF 인쇄(build.mjs)와 도움말 그림(help-figures.mjs)이 화면과 같게 나온다 — 두 명령이 같은 기다림·판정을 쓴다.
 * 디코딩 실패는 여기서 던지지 않는다(naturalWidth 0 으로 깨진 이미지에 잡힌다).
 */
export async function waitForPageAssets(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    return [...document.images].filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute('src'));
  });
}
