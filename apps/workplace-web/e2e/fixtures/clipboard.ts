// Clipboard API 가 없는 환경(사내망 http 배포 등 비보안 컨텍스트)을 흉내 내는 E2E 도우미(WP-836).
// navigator.clipboard 를 없애고 document.execCommand('copy') 대체 경로의 결과를 정한다 — 성공이면 복사된 글자를
// window.__copied 에 남겨, 공용 copyText 가 숨긴 textarea 로 무엇을 복사했는지 확인할 수 있게 한다.
import type { Page } from '@playwright/test';

/** goto 전에 부른다. execOk=false 면 대체 경로도 실패한다(두 경로 모두 실패 → 실패 안내). */
export async function withoutClipboardApi(page: Page, execOk: boolean) {
  await page.addInitScript((ok) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined });
    document.execCommand = () => {
      if (ok) {
        (window as unknown as { __copied?: string }).__copied = (document.activeElement as HTMLTextAreaElement).value;
      }
      return ok;
    };
  }, execOk);
}

/** withoutClipboardApi(page, true) 뒤 대체 경로로 복사된 글자. */
export function copiedViaFallback(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
}
