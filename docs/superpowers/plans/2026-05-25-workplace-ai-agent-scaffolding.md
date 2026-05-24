# workplace-ai-agent 스캐폴딩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/workplace-ai-agent/` 신규 — Express 4 + TS 골격, `POST /events` 수신 엔드포인트(인증·envelope 검증만), workplace-api 호출 stub client, Claude Agent SDK 의존성·import 만. 본 epic 의 어떤 코드도 LLM 호출이나 workplace-api 실호출을 하지 않는다.

**Architecture:** firehub-ai-agent 패턴 차용. Express + Internal token 인증 + zod envelope 검증 + 5b 가 채울 type 디스패치 자리. 단일 commit (TDD 진행하되 task 별 commit 없이 마지막에 한 번).

**Tech Stack:** Node.js 22 / TypeScript ES2022 NodeNext / Express 4 / Zod 4 / Vitest 4 + supertest / `@anthropic-ai/claude-agent-sdk` (의존성만) / axios / dotenv

---

## 커밋 정책

각 task 는 파일 변경만 수행하고 commit 하지 않는다. **마지막 Task 9 에서 단일 commit**:

```
feat(ai-agent): workplace-ai-agent 스캐폴딩 — #32
```

이유: spec 의 커밋 정책. main 브랜치 직접 작업.

## File Structure

```
apps/workplace-ai-agent/
├── .env.example
├── .gitignore
├── .prettierrc
├── CLAUDE.md
├── Dockerfile
├── README.md
├── eslint.config.js
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── agent/
    │   └── index.ts                  # @anthropic-ai/claude-agent-sdk import, 빈 export
    ├── clients/
    │   └── workplace-api.ts          # axios instance + 시그니처 (throw)
    ├── constants.ts                  # DEFAULT_PORT, INTERNAL_AUTH_SCHEME
    ├── index.ts                      # Express 부트, graceful shutdown
    ├── middleware/
    │   ├── internal-auth.ts
    │   └── internal-auth.test.ts
    └── routes/
        ├── events.ts
        ├── events.test.ts
        ├── health.ts
        └── health.test.ts
```

루트:
- `CLAUDE.md` — 서비스 섹션·포트 섹션 갱신

---

## Task 1: 패키지 골격 — package.json + TS/lint/format/test 설정

**Files:**
- Create: `apps/workplace-ai-agent/package.json`
- Create: `apps/workplace-ai-agent/tsconfig.json`
- Create: `apps/workplace-ai-agent/eslint.config.js`
- Create: `apps/workplace-ai-agent/.prettierrc`
- Create: `apps/workplace-ai-agent/vitest.config.ts`
- Create: `apps/workplace-ai-agent/.gitignore`

`pnpm-workspace.yaml` 은 이미 `apps/*` 글롭을 포함하므로 별도 수정 불필요 (Task 9 검증).

- [ ] **Step 1: `package.json` 작성**

```json
{
  "name": "@smart-workplace/workplace-ai-agent",
  "version": "0.0.1",
  "description": "AI Agent service for Smart Workplace",
  "type": "module",
  "main": "dist/index.js",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write src/"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.45",
    "axios": "^1.7.9",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.2",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.5",
    "@types/supertest": "^6.0.2",
    "@vitest/coverage-v8": "^4.1.4",
    "eslint": "^9.39.2",
    "eslint-config-prettier": "^10.1.8",
    "prettier": "^3.8.1",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "typescript-eslint": "^8.55.0",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "lib": ["ES2022"],
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: `eslint.config.js` 작성**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);
```

- [ ] **Step 4: `.prettierrc` 작성**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 5: `vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'dist/**',
        'node_modules/**',
        '**/*.test.ts',
        '**/*.d.ts',
        'vitest.config.ts',
      ],
    },
  },
});
```

- [ ] **Step 6: `.gitignore` 작성**

```
node_modules
dist
coverage
.env
.env.local
*.log
.turbo
```

- [ ] **Step 7: 워크스페이스 설치 검증**

루트에서:
```bash
pnpm install
```

기대: workspace 에 `@smart-workplace/workplace-ai-agent` 등장. 에러 없이 종료. lockfile 갱신.

---

## Task 2: 환경/문서 골격 — constants + .env.example + Dockerfile + README

**Files:**
- Create: `apps/workplace-ai-agent/src/constants.ts`
- Create: `apps/workplace-ai-agent/.env.example`
- Create: `apps/workplace-ai-agent/Dockerfile`
- Create: `apps/workplace-ai-agent/README.md`

- [ ] **Step 1: `src/constants.ts` 작성**

```ts
// 로컬 기본 포트 — workplace-api(9090), workplace-web(6173) 과 분리.
export const DEFAULT_PORT = 7070;

// 사내 서비스 간 인증 스킴 — Authorization: Internal {token}
export const INTERNAL_AUTH_SCHEME = 'Internal ';

// workplace-api 기본 URL — .env 에서 override.
export const DEFAULT_API_BASE_URL = 'http://localhost:9090/api/v1';
```

- [ ] **Step 2: `.env.example` 작성**

```
# Server
PORT=7070

# 사내 서비스 인증 — workplace-api 가 이벤트를 푸시할 때 사용
INTERNAL_SERVICE_TOKEN=changeme-local

# workplace-api 호출용 (Phase 5c 에서 사용 예정 — 현 시점 미호출)
WORKPLACE_API_BASE_URL=http://localhost:9090/api/v1
WORKPLACE_AGENT_API_KEY=changeme-local

# Anthropic API Key — Claude Agent SDK 폴백용 (현 시점 미호출)
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: `Dockerfile` 작성** (firehub 패턴 차용, 포트만 7070)

```dockerfile
# === Stage 1: Build ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/workplace-ai-agent/package.json ./apps/workplace-ai-agent/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-ai-agent...

COPY apps/workplace-ai-agent/ ./apps/workplace-ai-agent/

RUN pnpm --filter @smart-workplace/workplace-ai-agent build

RUN pnpm --filter @smart-workplace/workplace-ai-agent deploy --legacy --prod /prod

# === Stage 2: Runtime ===
FROM node:22-alpine

# Claude Code CLI — @anthropic-ai/claude-agent-sdk 요구
RUN npm install -g @anthropic-ai/claude-code

# Claude Code CLI 가 root 실행을 차단하므로 비루트 사용자 생성
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build /prod ./
COPY --from=build /app/apps/workplace-ai-agent/dist ./dist

RUN chown -R appuser:appgroup /app

RUN mkdir -p /home/appuser/.claude/debug /home/appuser/.claude/projects \
    && echo '{}' > /home/appuser/.claude/remote-settings.json \
    && chown -R appuser:appgroup /home/appuser/.claude

USER appuser

EXPOSE 7070

CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: `README.md` 작성**

```markdown
# workplace-ai-agent

Smart Workplace 의 AI Agent 서비스. 현재는 **스캐폴딩 단계** — 이벤트 수신 + 의존성 골격만 마련되어 있으며 실제 LLM 호출 / MCP 도구 / workplace-api 호출은 미구현. Phase 5b/5c 에서 채워진다.

## Commands

\`\`\`bash
pnpm dev          # tsx watch — 포트 7070
pnpm build        # tsc
pnpm start        # node dist/index.js
pnpm test         # Vitest
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
\`\`\`

## 환경변수

`.env.example` 참고. 로컬에서는 `.env.local` 사용.

## 엔드포인트

- `POST /events` — Internal token 인증, envelope 검증 후 type 디스패치. 본 시점 분기 0개 → `unsupported_event_type` 응답.
- `GET /health` — liveness, `{ status: 'ok' }`

## 자세한 가이드

`CLAUDE.md` 참고.
```

(README 본문의 백틱 3개 블록은 실제 작성 시 백슬래시 제거)

---

## Task 3: internal-auth 미들웨어 (TDD)

**Files:**
- Create: `apps/workplace-ai-agent/src/middleware/internal-auth.ts`
- Create: `apps/workplace-ai-agent/src/middleware/internal-auth.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/middleware/internal-auth.test.ts`)

```ts
// 사내 서비스 인증 미들웨어 — Authorization: Internal {token} 검증.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { internalAuth } from './internal-auth.js';

function mockReq(authHeader?: string): Partial<Request> {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

function mockRes(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((data: unknown) => {
    res.body = data;
    return res as Response;
  });
  return res;
}

describe('internalAuth', () => {
  const VALID = 'test-token-12345';

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  it('올바른 토큰 → next() 호출', () => {
    const req = mockReq(`Internal ${VALID}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Authorization 헤더 없음 → 401', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('Bearer 스킴 → 401', () => {
    const req = mockReq(`Bearer ${VALID}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('잘못된 토큰 → 401', () => {
    const req = mockReq('Internal wrong-token');
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('서버에 INTERNAL_SERVICE_TOKEN 미설정 → 500', () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const req = mockReq(`Internal ${VALID}`);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    internalAuth(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: FAIL — `Cannot find module './internal-auth.js'`

- [ ] **Step 3: 미들웨어 구현** (`src/middleware/internal-auth.ts`)

```ts
// 사내 서비스 간 인증 — Authorization: Internal {token} 헤더의 토큰을
// INTERNAL_SERVICE_TOKEN 환경변수와 timingSafeEqual 로 비교한다.
// 타이밍 공격 방지를 위해 단순 === 비교가 아닌 crypto 의 안전 비교 사용.
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { INTERNAL_AUTH_SCHEME } from '../constants.js';

export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(INTERNAL_AUTH_SCHEME)) {
    res.status(401).json({ error: 'unauthorized', reason: 'missing_or_invalid_scheme' });
    return;
  }

  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected) {
    // 운영 실수 — 서버 설정 누락. 클라이언트에는 일반 500.
    console.error('[internalAuth] INTERNAL_SERVICE_TOKEN 환경변수 미설정');
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  const token = header.substring(INTERNAL_AUTH_SCHEME.length);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);

  if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
    res.status(401).json({ error: 'unauthorized', reason: 'invalid_token' });
    return;
  }

  next();
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: 5 passed.

---

## Task 4: /health 라우트 (TDD)

**Files:**
- Create: `apps/workplace-ai-agent/src/routes/health.ts`
- Create: `apps/workplace-ai-agent/src/routes/health.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/routes/health.test.ts`)

```ts
// /health 라우트 — supertest 로 in-process 검증.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { healthRouter } from './health.js';

function buildApp() {
  const app = express();
  app.use(healthRouter);
  return app;
}

describe('GET /health', () => {
  it('200 + { status: "ok" }', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: FAIL — `Cannot find module './health.js'`

- [ ] **Step 3: 라우트 구현** (`src/routes/health.ts`)

```ts
// liveness probe — 외부 의존성 검사 없이 단순 200.
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: 6 passed (이전 5 + 신규 1).

---

## Task 5: /events 라우트 (TDD)

**Files:**
- Create: `apps/workplace-ai-agent/src/routes/events.ts`
- Create: `apps/workplace-ai-agent/src/routes/events.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/routes/events.test.ts`)

```ts
// POST /events — envelope 검증 + type 디스패치. 본 epic 은 분기 0개.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eventsRouter } from './events.js';
import { internalAuth } from '../middleware/internal-auth.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, eventsRouter);
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

describe('POST /events', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp())
      .post('/events')
      .send({ type: 'issue.created', payload: {} });
    expect(res.status).toBe(401);
  });

  it('envelope 누락(type 없음) → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('payload 필드 누락 → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('알 수 없는 type → 400 unsupported_event_type', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'unsupported_event_type', type: 'issue.created' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: FAIL — `Cannot find module './events.js'`

- [ ] **Step 3: 라우트 구현** (`src/routes/events.ts`)

```ts
// 이벤트 수신 엔드포인트 — workplace-api 가 도메인 이벤트를 푸시한다.
// envelope({type, payload}) 만 검증하고 type 별 분기는 Phase 5b 에서 채운다.
// 처리 결과는 항상 202 — 실제 처리는 비동기 약속 (본 시점은 로그만).
import { Router } from 'express';
import { z } from 'zod';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export const eventsRouter = Router();

eventsRouter.post('/events', (req, res) => {
  const parsed = envelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_payload',
      issues: parsed.error.issues,
    });
    return;
  }

  const { type } = parsed.data;

  // Phase 5b 가 이 switch 에 type 별 분기를 추가한다.
  switch (type) {
    default:
      // 현 시점 모든 type 이 미지원 — 발신자에게 명시적으로 알린다.
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
  }

  // 위 switch 가 모든 경로를 반환하므로 아래는 도달 불가 — 5b 가 채울 자리:
  //   console.log('[events] received', { type });
  //   res.status(202).json({ received: true });
});
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: 10 passed (이전 6 + 신규 4).

---

## Task 6: workplace-api client stub

**Files:**
- Create: `apps/workplace-ai-agent/src/clients/workplace-api.ts`

- [ ] **Step 1: client 작성**

```ts
// workplace-api 호출용 axios 인스턴스 + 메서드 시그니처.
// 본 epic 은 호출 미구현 — 모든 메서드가 즉시 throw. Phase 5c 에서 채운다.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';

export interface WorkplaceApiClient {
  // 이슈에 코멘트 작성 — AGENT 권한 (Phase 5c).
  addIssueComment(issueKey: string, body: string): Promise<void>;
  // 이슈 상태 변경 — AGENT 권한 (Phase 5c).
  updateIssueStatus(issueKey: string, statusKey: string): Promise<void>;
}

const NOT_IMPL = 'workplace-api client 는 스캐폴딩 단계에서 미구현 — Phase 5c 에서 채움';

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  apiKey: string;
}): WorkplaceApiClient {
  // axios 인스턴스는 Phase 5c 가 사용. 본 epic 은 생성만.
  const _http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { 'X-Api-Key': opts.apiKey },
  });
  void _http; // 사용처 없음을 명시 — 5c 가 메서드 본문에서 사용

  return {
    async addIssueComment(_issueKey, _body) {
      throw new Error(NOT_IMPL);
    },
    async updateIssueStatus(_issueKey, _statusKey) {
      throw new Error(NOT_IMPL);
    },
  };
}
```

- [ ] **Step 2: typecheck 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent typecheck
```
기대: 에러 없이 종료.

테스트는 추가하지 않는다 — stub 메서드는 throw 만 하고 어디서도 호출되지 않으므로 테스트는 5c 에서 실구현과 함께 작성.

---

## Task 7: agent SDK import stub + index.ts 부트스트랩

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/index.ts`
- Create: `apps/workplace-ai-agent/src/index.ts`

- [ ] **Step 1: agent SDK import stub** (`src/agent/index.ts`)

```ts
// Claude Agent SDK import — 본 epic 은 패키지 의존성만 확보, 호출 미구현.
// Phase 5b/5c 에서 query() / createSdkMcpServer() 패턴을 채운다.
import { query } from '@anthropic-ai/claude-agent-sdk';

// re-export 만 두어 트리쉐이킹 대상 노출을 방지.
export { query };
```

- [ ] **Step 2: 부트스트랩** (`src/index.ts`)

```ts
// Express 부트 — 미들웨어 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());

// /health 는 인증 없이 노출 — k8s 프로브 등을 가정.
app.use(healthRouter);
// /events 는 사내 서비스 인증 필수.
app.use(internalAuth, eventsRouter);

// 전역 에러 핸들러 — 라우트에서 처리 못 한 throw 의 안전망.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  console.log(`workplace-ai-agent listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /events`);
});

// SIGTERM/SIGINT 시 진행 중 요청 5초 대기 후 강제 종료.
function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 3: typecheck + build 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent typecheck
pnpm --filter @smart-workplace/workplace-ai-agent build
```
기대: 둘 다 에러 없이 종료. `dist/index.js` 생성.

---

## Task 8: CLAUDE.md — 앱 가이드 + 루트 갱신

**Files:**
- Create: `apps/workplace-ai-agent/CLAUDE.md`
- Modify: `CLAUDE.md` (루트)

- [ ] **Step 1: 앱 CLAUDE.md 작성** (`apps/workplace-ai-agent/CLAUDE.md`)

```markdown
# CLAUDE.md (workplace-ai-agent)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 ai-agent 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **AI Agent 서비스**. 현재는 **스캐폴딩 단계** — 이벤트 수신 엔드포인트와 의존성 골격만 마련. 실제 LLM 호출 / MCP 도구 / workplace-api 호출은 미구현. Phase 5b (이벤트 수신 처리) / 5c (workplace-api 응답) 에서 채워진다.

## Commands

\`\`\`bash
pnpm dev          # tsx watch (포트 7070)
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
pnpm test         # Vitest (in-process supertest)
pnpm test:watch
pnpm lint
pnpm typecheck
\`\`\`

## Stack

Node.js 22 + TypeScript (ES2022, NodeNext), Express 4, Zod 4, axios, dotenv, `@anthropic-ai/claude-agent-sdk` (의존성만), Vitest 4 + supertest.

## Layered Structure

\`\`\`
src/
  agent/                # Claude Agent SDK import (현 시점 빈 export)
  clients/              # workplace-api 호출용 axios client (현 시점 throw stub)
  middleware/           # internal-auth (Authorization: Internal {token})
  routes/               # health, events
  constants.ts          # DEFAULT_PORT, INTERNAL_AUTH_SCHEME, DEFAULT_API_BASE_URL
  index.ts              # Express 부트 + graceful shutdown
\`\`\`

## Key Patterns

- **인증**: 사내 서비스 간 호출은 `Authorization: Internal {token}` + `timingSafeEqual`. 토큰은 `INTERNAL_SERVICE_TOKEN` 환경변수.
- **이벤트 수신**: 단일 `POST /events` + `{ type, payload }` envelope. type 별 분기는 Phase 5b 가 채움. 본 시점 모든 type 은 `unsupported_event_type` 응답.
- **검증**: envelope 만 zod 로 검증. payload 내부 스키마는 5b 에서 `discriminatedUnion` 으로.
- **응답 계약**: 처리 성공 시 `202 { received: true }` (비동기 처리 약속). 본 시점은 모든 분기가 4xx.
- **에러 처리**: 라우트 try/catch + 전역 핸들러 500 안전망. 로깅은 `console.log/error`.

## Conventions

- **한국어 주석 필수** (루트 코딩 컨벤션 참고)
- ESM (`"type": "module"`), import 시 `.js` 확장자 명시
- 새 라우트는 `src/routes/`, 새 middleware 는 `src/middleware/`, 새 external client 는 `src/clients/`
- 테스트: 라우트는 supertest 로 in-process, 단순 함수는 직접 호출. 모든 신규 코드에 vitest 테스트 동반.

## Testing

\`\`\`bash
pnpm test                              # 전체
pnpm test src/routes/events.test.ts    # 단일 파일
pnpm test --coverage                   # 커버리지 (./coverage)
\`\`\`

`.test.ts` 는 대상 파일과 같은 디렉토리에 둔다.

## 환경변수

`.env.example` 참고. 로컬은 `.env.local` 사용 (dotenv 가 `.env.local` 먼저, `.env` 후순위로 로드).
```

(CLAUDE.md 본문의 백틱 3개 블록은 실제 작성 시 백슬래시 제거)

- [ ] **Step 2: 루트 CLAUDE.md 갱신**

루트 `CLAUDE.md` 의 두 줄을 수정. 현재 내용:

```
- 로컬 API: 포트 9090 (firehub-api 8090 과 분리)
- 로컬 Web: 포트 6173 (firehub-web 5173 과 분리)
```

→ 아래 줄을 그 뒤에 추가:

```
- 로컬 AI Agent: 포트 7070
```

그리고 Architecture 섹션의:

```
- **별도 서비스**: workplace-channel (실시간), workplace-ai-agent (Claude Agent SDK) — 향후 추가
```

→ 다음으로 교체:

```
- **별도 서비스**: workplace-ai-agent (Claude Agent SDK, 스캐폴딩 완료 — 5b/5c 에서 로직 채움), workplace-channel (실시간, 향후 추가)
```

그리고 Key Files 섹션의:

```
- 앱별 상세 (예정): `apps/workplace-api/CLAUDE.md`, `apps/workplace-web/CLAUDE.md`
```

→ 다음으로 교체:

```
- 앱별 상세: `apps/workplace-api/CLAUDE.md`, `apps/workplace-web/CLAUDE.md`, `apps/workplace-ai-agent/CLAUDE.md`
```

- [ ] **Step 3: 변경 사항 확인**

```bash
git diff CLAUDE.md
```
기대: 위 세 가지 변경이 반영.

---

## Task 9: 전체 검증 + 단일 커밋

이 task 가 본 plan 의 유일한 commit 지점.

- [ ] **Step 1: 워크스페이스 install 재실행 (lockfile 동기화)**

```bash
pnpm install
```
기대: 에러 없이 종료. `pnpm-lock.yaml` 갱신.

- [ ] **Step 2: 전체 lint**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent lint
```
기대: 에러 없음.

- [ ] **Step 3: 전체 typecheck**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent typecheck
```
기대: 에러 없음.

- [ ] **Step 4: 전체 테스트**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test
```
기대: 10 passed (auth 5 + health 1 + events 4).

- [ ] **Step 5: 빌드**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent build
```
기대: `apps/workplace-ai-agent/dist/index.js` 생성.

- [ ] **Step 6: 런타임 스모크 — dev 서버 + curl**

```bash
# 백그라운드 기동
INTERNAL_SERVICE_TOKEN=changeme-local pnpm --filter @smart-workplace/workplace-ai-agent dev &
DEV_PID=$!
sleep 3

# health
curl -s http://localhost:7070/health
# 기대: {"status":"ok"}

# events — 인증 없음
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:7070/events \
  -H 'Content-Type: application/json' -d '{"type":"issue.created","payload":{}}'
# 기대: 401

# events — 알 수 없는 type
curl -s -X POST http://localhost:7070/events \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Internal changeme-local' \
  -d '{"type":"issue.created","payload":{}}'
# 기대: {"error":"unsupported_event_type","type":"issue.created"}

# 종료
kill $DEV_PID
```

기대: 세 출력이 모두 위 주석과 일치.

- [ ] **Step 7: 루트 통합 검증 — turbo 파이프라인**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
기대: 모두 통과. workplace-ai-agent 가 turbo 그래프에 자동 편입되었는지 확인 (`turbo run` 출력에 `@smart-workplace/workplace-ai-agent` 등장).

- [ ] **Step 8: git status 로 변경 사항 점검**

```bash
git status
git diff --stat
```
기대 (예시):
- 신규: `apps/workplace-ai-agent/**`, `docs/superpowers/plans/2026-05-25-workplace-ai-agent-scaffolding.md`
- 수정: `CLAUDE.md`, `pnpm-lock.yaml`

- [ ] **Step 9: 단일 커밋**

```bash
git add apps/workplace-ai-agent CLAUDE.md pnpm-lock.yaml docs/superpowers/plans/2026-05-25-workplace-ai-agent-scaffolding.md
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(ai-agent): workplace-ai-agent 스캐폴딩 — #32

- Express 4 + TS 골격 (포트 7070)
- POST /events: Internal token + envelope 검증, type 분기는 5b 에서
- GET /health
- workplace-api 호출용 axios client (시그니처만, throw)
- Claude Agent SDK 의존성 (호출 미구현)
- Vitest + supertest 테스트 (인증·envelope·health)
- 루트 CLAUDE.md 서비스/포트 섹션 갱신
EOF
)"
```

기대: 에러 없이 commit 완료. pre-commit hook 통과.

- [ ] **Step 10: 최종 git log 확인**

```bash
git log --oneline -5
```
기대: 가장 최근 commit 이 본 task 의 커밋 메시지.

---

## Self-Review

**Spec coverage:**
- 디렉토리/스택 — Task 1, 2 ✅
- 포트 7070 — Task 2 (constants) + 검증 Task 9 ✅
- internal-auth + timingSafeEqual — Task 3 ✅
- POST /events 흐름 (envelope → type 분기) — Task 5 ✅
- /health — Task 4 ✅
- workplace-api client stub (throw) — Task 6 ✅
- Agent SDK 의존성 + import — Task 1 (의존성) + Task 7 (import) ✅
- Express 부트 + graceful shutdown — Task 7 ✅
- 전역 에러 핸들러 — Task 7 ✅
- 테스트 (auth/events/health) — Task 3/4/5 ✅
- 앱 CLAUDE.md + 루트 갱신 — Task 8 ✅
- Dockerfile — Task 2 ✅
- DoD 명령들 — Task 9 ✅
- 단일 commit — Task 9 ✅

**Placeholder scan:** 없음.

**Type consistency:** `internalAuth`, `eventsRouter`, `healthRouter`, `createWorkplaceApiClient`, `WorkplaceApiClient`, `DEFAULT_PORT`, `INTERNAL_AUTH_SCHEME`, `DEFAULT_API_BASE_URL` — 모든 사용처에서 동일 이름.
