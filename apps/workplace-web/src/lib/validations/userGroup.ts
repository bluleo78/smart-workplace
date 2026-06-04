import { z } from 'zod'

/** 개인 그룹 생성/수정 폼 검증(이름·부모). 멤버는 별도 피커로 관리. */
export const userGroupSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요').max(100, '100자 이내'),
  parentId: z.number().int().nullable(),
})
export type UserGroupFormData = z.infer<typeof userGroupSchema>
