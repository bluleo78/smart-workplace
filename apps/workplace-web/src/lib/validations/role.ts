import { z } from 'zod';

export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, '역할 이름을 입력하세요')
    .max(50, '역할 이름은 50자 이하여야 합니다')
    .regex(/^[A-Z][A-Z0-9_]*$/, '역할 이름은 대문자, 숫자, 밑줄만 허용됩니다'),
  // WP-570: 서버·DB(role.description VARCHAR(255))와 같은 상한.
  description: z.string().max(255, '역할 설명은 255자까지 쓸 수 있습니다').optional().or(z.literal('')),
});

export const updateRoleSchema = createRoleSchema;

export type CreateRoleFormData = z.infer<typeof createRoleSchema>;
export type UpdateRoleFormData = z.infer<typeof updateRoleSchema>;
