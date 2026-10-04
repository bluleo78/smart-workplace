import type { Page } from '@playwright/test'

import { external, externalDetail, member, page as makePage } from '../../factories/contacts.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

async function stubList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage([member(), external()])),
      }),
  )
}

test('목록 행 별 토글 — 추가 요청', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  const posts = trackRequests(page, 'POST', '/api/v1/contacts/favorites')
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/favorites',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto('/contacts')
  await page.getByTestId('contact-fav-EXTERNAL-100').click()

  await posts.waitFor()
  expect(posts.lastBody()).toMatchObject({ targetType: 'EXTERNAL', targetId: 100 })
})

test('상세 패널 별 토글 — 추가 요청', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/external/100',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(externalDetail({ isFavorite: false })),
      }),
  )
  const posts = trackRequests(page, 'POST', '/api/v1/contacts/favorites')
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/favorites',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto('/contacts')
  await page.getByTestId('contact-row-EXTERNAL-100').click()
  await expect(page.getByTestId('contact-detail-external')).toBeVisible()
  await page.getByTestId('contact-detail-fav').click()

  await posts.waitFor()
  expect(posts.lastBody()).toMatchObject({ targetType: 'EXTERNAL' })
})
