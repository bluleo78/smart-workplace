// 메일 작성창 수신인 칩(WP-945) 확인 도우미 — 받는사람·참조·숨은참조는 넣은 주소를 칩으로 보이므로 입력 칸 값 대신 칩을 본다.
import { expect, type Page } from '@playwright/test'

/** 수신인 칸 이름 — data-testid `mail-compose-<field>`. */
export type RecipientField = 'to' | 'cc' | 'bcc'

/** 칩들의 값(`이름 <주소>` 또는 주소)을 넣은 순서대로. */
export function recipientChipValues(page: Page, field: RecipientField) {
  return page
    .getByTestId(`mail-compose-${field}-chip`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-value')))
}

/** 칩이 정확히 이 값들인지(순서 포함) 조건 대기로 확인한다. */
export async function expectRecipientChips(page: Page, field: RecipientField, values: string[]) {
  await expect.poll(() => recipientChipValues(page, field)).toEqual(values)
}
