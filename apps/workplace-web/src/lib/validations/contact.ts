// 외부 연락처 폼 검증. optional 필드는 빈 문자열 허용(백엔드가 null 정규화).
import { z } from 'zod'

/** 외부 연락처 메모 상한 — 서버 ExternalContactRequest.notes @Size 와 같다(WP-546). */
export const CONTACT_NOTES_MAX = 2000

export const externalContactSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요').max(120, '120자 이내'),
  email: z
    .string()
    .trim()
    .max(255, '255자 이내')
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), '유효한 이메일을 입력하세요'),
  phone: z.string().trim().max(40, '40자 이내'),
  organization: z.string().trim().max(120, '120자 이내'),
  title: z.string().trim().max(100, '100자 이내'),
  notes: z.string().trim().max(CONTACT_NOTES_MAX, `메모는 ${CONTACT_NOTES_MAX}자 이하여야 합니다`),
  visibility: z.enum(['SHARED', 'PERSONAL']),
})

export type ExternalContactFormData = z.infer<typeof externalContactSchema>
