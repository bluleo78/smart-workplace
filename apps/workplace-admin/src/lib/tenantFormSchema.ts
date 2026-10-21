// 테넌트 이름·slug 폼 규칙 — 생성(CreateTenantDialog)·수정(EditTenantDialog)이 같은 규칙을 쓰도록 한 곳에 둔다(WP-669).
// 서버(CreateTenantRequest·UpdateTenantRequest 의 TenantSlugRule)와 같은 규칙이다. 예전엔 생성 폼이 slug 를 검사하지 않아
// 형식이 틀린 slug 가 저장됐다.
import { z } from 'zod'

/** 이름 — 필수(공백만은 불가), tenant.name VARCHAR(255). */
export const tenantNameField = z.string().trim().min(1, '이름을 입력하세요').max(255, '255자 이하로 입력하세요')

/** slug — 선택. 비우면 서버가 이름에서 자동 생성. 값이 있으면 영문 소문자·숫자·하이픈만, tenant.slug VARCHAR(64). */
export const tenantSlugField = z
  .string()
  .trim()
  .max(64, '64자 이하로 입력하세요')
  .regex(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/, '영문 소문자·숫자·하이픈만 사용할 수 있습니다')
