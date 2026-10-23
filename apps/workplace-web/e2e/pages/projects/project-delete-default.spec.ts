// 프로젝트 설정 「위험 구역」 — 기본 개인 프로젝트는 삭제 버튼 대신 이유를 미리 알리고, 확인창 문구는 조사·설명이 맞다(WP-857).
// 백엔드 없이 page.route 로 모킹한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { mockProjectSettings } from '../../fixtures/project-settings-mocks';
import { createMember, createProject } from '../../factories/project.factory';

const OWNER = [createMember({ userId: 1, role: 'OWNER' })];

test('기본 개인 프로젝트는 삭제 버튼 대신 지울 수 없다는 안내가 미리 보인다', async ({ authenticatedPage: page }) => {
  await mockProjectSettings(page, OWNER, createProject({ key: 'P1', name: '내 프로젝트', type: 'PERSONAL', isDefault: true }));

  await page.goto('/projects/P1/settings');

  // 위험 구역(소유자에게만 보임)은 남아 이유를 알리고, 누르면 409 로 거절될 삭제 버튼은 없다.
  const danger = page.getByRole('heading', { name: '위험 구역' });
  await expect(danger).toBeVisible();
  await expect(page.getByText('처음부터 있던 기본 개인 프로젝트는 지울 수 없어요.').last()).toBeVisible();
  await expect(page.getByTestId('project-delete')).toHaveCount(0);
  await expect(page.getByText('프로젝트를 삭제하면 이슈와 코멘트도 함께 숨겨져요.')).toHaveCount(0);
});

test('일반 개인 프로젝트는 삭제할 수 있고, 확인창은 「프로젝트를」로 맺으며 함께 숨겨진다고 알린다', async ({ authenticatedPage: page }) => {
  await mockProjectSettings(page, OWNER, createProject({ key: 'P2', name: '사이드 프로젝트', type: 'PERSONAL', isDefault: false }));

  await page.goto('/projects/P2/settings');

  const button = page.getByTestId('project-delete');
  await expect(button).toBeEnabled();
  await expect(page.getByText('프로젝트를 삭제하면 이슈와 코멘트도 함께 숨겨져요.')).toBeVisible();
  await button.click();
  await expect(page.getByRole('alertdialog')).toContainText(
    '「사이드 프로젝트」(P2) 프로젝트를 삭제할까요? 이슈와 코멘트도 함께 숨겨지고, 화면에서 되돌릴 수 없어요.',
  );
});
