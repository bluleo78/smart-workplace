// 외부 연락처 폼 검증. optional 필드는 빈 문자열 허용(백엔드가 null 정규화).
import { z } from 'zod'

export const externalContactSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요').max(120, '120자 이내'),
  email: z
    .string()
    .trim()
    .max(255, '255자 이내')
    .email('유효한 이메일을 입력하세요')
    .or(z.literal(''))
    .default(''),
  phone: z.string().trim().max(40, '40자 이내').default(''),
  organization: z.string().trim().max(120, '120자 이내').default(''),
  title: z.string().trim().max(100, '100자 이내').default(''),
  notes: z.string().default(''),
  visibility: z.enum(['SHARED', 'PERSONAL']),
})

export type ExternalContactFormData = z.infer<typeof externalContactSchema>
