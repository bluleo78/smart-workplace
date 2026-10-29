// 매뉴얼 명령줄 스크립트 공용 도구: 책별 검사 실행기와 Playwright 불러오기.
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
