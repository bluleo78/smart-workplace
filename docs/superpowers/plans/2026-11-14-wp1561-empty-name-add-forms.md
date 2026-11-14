# WP-1561 — 프로젝트 설정 추가 폼: 빈 이름으로 추가를 누르면 아무 반응이 없다

## 문제
프로젝트 설정의 이슈 유형·라벨·프로젝트 필드 추가 폼은 이름이 비어도 「추가」가 눌리는데, `onCreate` 가 `if (!trimmed) return;` 으로 조용히 끝나 사용자는 왜 안 되는지 모른다.

## 방향(디자인 시스템 09-form-patterns — 제출 단추는 제출 중에만 비활성, 검증 오류는 칸 아래에)
- 「추가」 단추는 그대로 눌리게 둔다(빈 이름 때문에 비활성으로 바꾸지 않는다).
- 이름이 비었거나 공백뿐인 채 제출하면 이름 칸 아래에 `이름을 입력해 주세요`(CustomFieldEditDialog 와 같은 문구)를 `role="alert"` 로 보이고, 칸에 `aria-invalid`·`aria-describedby` 를 달고, 이름 칸에 포커스를 둔다. 요청은 보내지 않는다.
- 이름을 입력하면(onChange) 그 오류를 지운다.
- 라벨 폼은 기존 쉼표 오류(WP-1386, 입력 중 실시간)와 함께 쓴다 — 쉼표 오류가 있으면 그것을, 아니면 빈 이름 오류를 보인다(한 번에 하나).

## 대상
- `apps/workplace-web/src/pages/projects/components/IssueTypeManagement.tsx`
- `apps/workplace-web/src/pages/projects/components/LabelManagement.tsx`
- `apps/workplace-web/src/pages/projects/components/CustomFieldManagement.tsx`

## 테스트(vitest)
- `src/pages/projects/issueTypes.test.tsx`·`labels.test.tsx`·`customFields.test.tsx` 에 각각: 빈 이름(공백만 포함)으로 추가 → 오류 문구 보임·요청 없음·이름 칸 포커스 → 입력하면 오류 사라짐.
- 새 단언은 로직을 일부러 깨 실패하는지 확인한다.
