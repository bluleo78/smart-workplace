// /settings/roles/:id — 역할 상세 페이지 E2E.
// 시스템 역할(isSystem=true)에서 설명 필드가 disabled 처리되는지 검증한다 (#185).

import { expect, test } from '../../fixtures/auth.fixture';
import { setupAdminAuth, setupRoleDetailMocks } from '../../fixtures/admin.fixture';

test.describe('/settings/roles/:id — 시스템 역할 필드 비활성화', () => {
  test(
    '시스템 역할 상세: 역할 이름·설명 필드와 저장 버튼이 모두 disabled',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      await setupAdminAuth(page);
      // isSystem=true 인 역할 상세 모킹
      await setupRoleDetailMocks(page, 1, true);

      await page.goto('/settings/roles/1');
      await expect(page.getByRole('heading', { name: '역할 상세' })).toBeVisible();

      // 역할 이름 필드 — disabled 확인
      const nameInput = page.getByRole('textbox', { name: '역할 이름' });
      await expect(nameInput).toBeDisabled();

      // 설명 필드 — disabled 확인 (수정 전에는 이 검증이 실패했던 핵심 케이스)
      const descriptionInput = page.getByRole('textbox', { name: '설명' });
      await expect(descriptionInput).toBeDisabled();

      // 저장 버튼 — disabled 확인 (exact: true 로 '권한 저장' 버튼과 구분)
      const saveButton = page.getByRole('button', { name: '저장', exact: true });
      await expect(saveButton).toBeDisabled();

      // 잠금 안내 배너 + disabled 필드 시각 구분(bg-muted) — 수정 불가 이유를 명시 (#676)
      await expect(page.getByText('시스템 역할은 이름·설명·권한을 수정할 수 없습니다.')).toBeVisible();
      await expect(nameInput).toHaveClass(/disabled:bg-muted/);
    },
  );

  test(
    '커스텀 역할 상세: 역할 이름·설명 필드와 저장 버튼이 모두 활성화',
    async ({ adminPage: page }) => {
      await setupAdminAuth(page);
      // isSystem=false 인 커스텀 역할 상세 모킹
      await setupRoleDetailMocks(page, 3, false);

      await page.goto('/settings/roles/3');
      await expect(page.getByRole('heading', { name: '역할 상세' })).toBeVisible();

      // 커스텀 역할에서는 이름·설명 필드 모두 편집 가능
      const nameInput = page.getByRole('textbox', { name: '역할 이름' });
      await expect(nameInput).toBeEnabled();

      const descriptionInput = page.getByRole('textbox', { name: '설명' });
      await expect(descriptionInput).toBeEnabled();

      // 저장 버튼도 활성화 (exact: true 로 '권한 저장' 버튼과 구분)
      const saveButton = page.getByRole('button', { name: '저장', exact: true });
      await expect(saveButton).toBeEnabled();
    },
  );
});
