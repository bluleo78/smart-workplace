// 링크 미리보기(WP-894) — 카카오톡·Slack·iMessage 미리보기 봇은 로그인 없이 HTML 원문만 읽는다.
// 그래서 브라우저 렌더가 아니라 원문 HTML(깊은 링크도 같은 index.html)에 사이트 공통 og·twitter 메타가 있고,
// og:image 가 가리키는 공유 이미지가 실제로 1200×630 PNG 로 서빙되는지를 본다.
// 이미지 주소의 호스트(__PUBLIC_HOST__)는 운영 nginx 가 응답 때 채운다 — 여기(Vite 서버)에서는 그 자리표시가 그대로 있는지까지만 본다.
import { expect, type Page, test } from '@playwright/test'

/** 원문 HTML 을 문서로 읽어 meta 값을 꺼낸다 — 속성 순서·따옴표가 바뀌어도 같은 값을 읽게 정규식 대신 브라우저 파서를 쓴다. */
async function readMetas(page: Page, html: string) {
  await page.setContent(html.replace(/<script\b[\s\S]*?<\/script>/g, ''))
  return (key: string) =>
    page.locator(`meta[property="${key}"], meta[name="${key}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('content')))
}

test.describe('링크 미리보기 메타 (WP-894)', () => {
  test('로그인 없이 받은 깊은 링크 HTML 에 사이트 공통 미리보기 메타가 있고, 문구는 앱 설치 정보(manifest)와 같다', { tag: '@smoke' }, async ({ page, request }) => {
    // 미리보기 봇처럼 쿠키·토큰 없이 이슈 깊은 링크를 받는다 — SPA 라 모든 경로가 같은 index.html 이다.
    const res = await request.get('/projects/WP/issues/1')
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    const manifestHref = /<link rel="manifest" href="([^"]+)"/.exec(html)?.[1]
    expect(manifestHref, 'manifest 링크가 index.html 에 있어야 한다').toBeTruthy()
    const manifest = await (await request.get(manifestHref as string)).json()

    const meta = await readMetas(page, html)
    // 서비스 이름·소개는 manifest 와 같은 한 곳(vite.config.ts)에서 채워진다 — 자리표시가 남지 않는다.
    for (const key of ['description', 'og:description']) {
      expect(await meta(key), key).toEqual([manifest.description])
    }
    for (const key of ['og:title', 'og:site_name']) {
      expect(await meta(key), key).toEqual([manifest.name])
    }
    expect(await meta('og:image:alt')).toEqual([`${manifest.name} — ${manifest.description}`])
    expect(await meta('og:type')).toEqual(['website'])
    expect(await meta('og:image:width')).toEqual(['1200'])
    expect(await meta('og:image:height')).toEqual(['630'])
    expect(await meta('twitter:card')).toEqual(['summary_large_image'])
    // 이미지 주소는 호스트 자리표시 + 공유 이미지 경로 — 운영 nginx 가 요청 호스트로 바꾼다(nginx.conf sub_filter).
    expect(await meta('og:image')).toEqual(['https://__PUBLIC_HOST__/og-image.png'])
    // 대표 주소를 고정하면 깊은 링크가 루트로 묶이므로 og:url 은 두지 않는다.
    expect(await meta('og:url')).toEqual([])
  })

  test('공유 이미지가 1200×630 PNG 로 서빙된다', async ({ request }) => {
    const img = await request.get('/og-image.png')
    expect(img.ok()).toBeTruthy()
    expect(img.headers()['content-type']).toContain('image/png')
    const bytes = await img.body()
    // PNG IHDR — 16~24 바이트가 가로·세로(빅엔디언).
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(bytes.readUInt32BE(16)).toBe(1200)
    expect(bytes.readUInt32BE(20)).toBe(630)
  })
})
