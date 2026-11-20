// PDF 첨부 뷰어 E2E 공용 대기 헬퍼 (WP-1805).
// `pdf-page-N` 캔버스는 PdfPages 가 pdf.js 라이브러리·워커를 동적 import 하고 워커에서 문서를 파싱한 뒤에야 생긴다.
// 부하가 큰 커밋 훅에서는 이 첫 열기가 기본 expect 제한(10초, UI 반응용 값)을 넘어 실패했다 — 기능 결함이 아니라
// 「UI 반응 제한」을 「문서 열기 작업」에 잘못 쓴 대기다. 전역 expect 제한을 올리면 모든 UI 단언의 회귀 감지가 느려지므로
// PDF 열기 대기만 이 헬퍼로 모아 별도 예산을 준다.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

/** 문서 열기(라이브러리·워커 기동 + 파싱) 대기 예산(ms) — 조건 대기라 빨리 그려지면 바로 통과한다. */
const PDF_OPEN_TIMEOUT = 30_000;

/** 테스트 제한을 이미 늘린 테스트 — 한 테스트에서 여러 번 열어도 한 번만 늘린다(제한이 호출 수만큼 불어나지 않게). */
const extended = new WeakSet<TestInfo>();

/**
 * PDF 첫 쪽 캔버스(`pdf-page-1`)가 보일 때까지 문서 열기 예산으로 기다리고, 찾은 Locator 를 돌려준다.
 * 긴 대기가 뒤 단언의 시간을 빼앗지 않도록 테스트마다 처음 한 번 테스트 제한을 예산만큼 늘린다.
 * 제한 0(무제한 — `--debug`·`--timeout 0`)이면 그대로 둔다 — 더하면 무제한이 30초 제한으로 바뀐다.
 */
export async function expectPdfPageVisible(page: Page): Promise<Locator> {
  const info = test.info();
  if (info.timeout > 0 && !extended.has(info)) {
    extended.add(info);
    info.setTimeout(info.timeout + PDF_OPEN_TIMEOUT);
  }
  const locator = page.getByTestId('pdf-page-1');
  await expect(locator).toBeVisible({ timeout: PDF_OPEN_TIMEOUT });
  return locator;
}
