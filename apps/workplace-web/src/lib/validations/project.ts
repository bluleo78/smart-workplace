// 프로젝트 폼 검증 스키마 — 백엔드 ProjectRequest 제약과 일치시킨다.

import { z } from 'zod';

// 프로젝트 키: 대문자/숫자 2~10자, 첫 글자는 대문자 — 채팅 앱 링크 읽기(lib/appLinks)도 같은 규칙을 쓴다.
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/

export const projectKeySchema = z.string().regex(PROJECT_KEY_RE, {
  message: '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다',
});

// 프로젝트 이름: 앞뒤 공백을 뺀 값으로 검증·전송한다 — 공백만 넣으면 서버 400 토스트 대신 이 필드의 「필수」 오류로 막는다(WP-465).
const projectNameSchema = z.string().trim().min(1, '이름은 필수입니다').max(120, '이름은 120자 이하여야 합니다');

// TEAM·OPEN 은 key 필수(위 정규식), PERSONAL 은 key 생략(서버 자동 생성).
export const createProjectSchema = z
  .object({
    type: z.enum(['TEAM', 'PERSONAL', 'OPEN']).default('TEAM'),
    key: z.string().optional(),
    name: projectNameSchema,
    description: z.string().max(2000, '설명은 2000자 이하여야 합니다').optional(),
  })
  .superRefine((val, ctx) => {
    // TEAM·OPEN 은 key 정규식 검증 (projectKeySchema 재사용으로 규칙 단일화). PERSONAL 의 key 는 submit 시 제거됨.
    if ((val.type === 'TEAM' || val.type === 'OPEN') && !projectKeySchema.safeParse(val.key).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['key'],
        message: '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다',
      });
    }
  });
// 입력 타입(폼 상태): default 적용 전이라 type 이 optional. useForm 의 입력 제네릭에 사용.
export type CreateProjectFormInput = z.input<typeof createProjectSchema>;
// 출력 타입(검증 후): default 적용되어 type 필수. submit 핸들러/payload 에 사용.
export type CreateProjectFormData = z.output<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: projectNameSchema,
  description: z.string().max(2000, '설명은 2000자 이하여야 합니다').optional(),
});
export type UpdateProjectFormData = z.infer<typeof updateProjectSchema>;

/**
 * 연결된 저장소(WP-1011) — AI 가 clone 할 주소(https·ssh·사용자@호스트:경로)와 기본 브랜치. 둘 다 비워 둘 수 있다(개발이 아닌 프로젝트).
 * AI 컴퓨터가 셸로 clone 하므로 호스트·경로 글자만 받는다($ ; | ` 같은 셸 글자 금지) — 서버 UpdateProjectRequest 와 같은 규칙.
 * https 주소의 「아이디:토큰@」도 막는다(프로젝트를 보는 모두에게 보이고, 접근은 AI 컴퓨터의 git 자격 증명으로 한다). http:// 는 받지 않는다.
 * 브랜치는 git 브랜치 이름으로 쓸 수 있는 것만(clone --branch 가 거절할 .. // 끝의 / .lock 도), 비우면 저장소의 기본 브랜치.
 */
const REPOSITORY_URL_CREDENTIALS_RE = /^https:\/\/[^/]*@/;
const REPOSITORY_URL_RE =
  /^(https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?\/|ssh:\/\/([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?\/|[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:)[A-Za-z0-9._~/][A-Za-z0-9._~/-]*$/;
const REPOSITORY_BRANCH_RE = /^(?![-/.])(?!.*(\.\.|\/\/|\/\.))(?!.*([/.]|\.lock)$)[A-Za-z0-9._/-]+$/;

export const projectRepositorySchema = z.object({
  repositoryUrl: z
    .string()
    .trim()
    .max(500, '저장소 주소는 500자 이하여야 합니다')
    // 폼은 칸마다 첫 오류만 보여 준다(zodResolver 기본) — 아이디·토큰 안내가 형식 안내보다 먼저.
    .refine((v) => !REPOSITORY_URL_CREDENTIALS_RE.test(v), '주소에 아이디·토큰은 넣지 않아요 — AI 컴퓨터의 git 자격 증명으로 접근해요')
    .refine((v) => v === '' || REPOSITORY_URL_RE.test(v), 'https://, ssh:// 또는 사용자@호스트:경로 형식의 저장소 주소를 입력하세요'),
  repositoryBranch: z
    .string()
    .trim()
    .max(100, '브랜치 이름은 100자 이하여야 합니다')
    .refine(
      (v) => v === '' || REPOSITORY_BRANCH_RE.test(v),
      '브랜치 이름에는 영문·숫자·. _ / - 만 쓸 수 있고, .. · // 나 끝의 / · .lock 은 안 돼요',
    ),
});
export type ProjectRepositoryFormData = z.infer<typeof projectRepositorySchema>;
