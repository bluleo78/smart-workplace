// 모델 목록 조회 라우트.
//  - POST /models/list (Task10): OpenAI 호환 baseURL+apiKey 프로브 — 등록 전 검증과 opencode 드롭다운에서 재사용.
//  - POST /models/anthropic/list (#873): 저장된 anthropic 토큰으로 Anthropic Models API 실시간 조회.
import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const PROBE_TIMEOUT_MS = 10_000;

// 드롭다운 오픈 경로 — workplace-api 가 읽기 트랜잭션(DB 커넥션)을 쥔 채 기다리므로 프로브보다 짧게 끊는다.
const ANTHROPIC_TIMEOUT_MS = 5_000;

const anthropicRequestSchema = z.object({ token: z.string().min(1) });

// API 키(sk-ant-api…)는 x-api-key, 그 외(구독 OAuth sk-ant-oat…)는 Bearer + oauth 베타 헤더로 인증한다.
// 재시도 없이 짧게 끊는다(실패 시 workplace-api 가 정적 목록으로 폴백).
function anthropicClientFor(token: string): Anthropic {
  const common = { timeout: ANTHROPIC_TIMEOUT_MS, maxRetries: 0 };
  if (token.startsWith('sk-ant-api')) return new Anthropic({ ...common, apiKey: token, authToken: null });
  return new Anthropic({
    ...common,
    apiKey: null,
    authToken: token,
    defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
  });
}

const requestSchema = z.object({
  options: z.object({
    baseURL: z.string().min(1),
    apiKey: z.string().min(1),
  }),
});

// upstream 응답이 OpenAI 표준({ data: [...] })이든 배열 직반환이든 모델 id 배열만 추출.
// id 가 string 이 아닌 항목은 건너뛴다(방어적 파싱, 나머지 필드는 무시).
function extractModelIds(payload: unknown): string[] | null {
  const candidates = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!candidates) return null;

  const ids = candidates
    .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  return ids.length > 0 ? ids : null;
}

export function createModelsRouter(): Router {
  const router = Router();

  // 등록 전/후 공통 모델 프로브 — apiKey 는 응답/로그에 절대 노출하지 않는다.
  router.post('/models/list', async (req: Request, res: Response): Promise<void> => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { baseURL, apiKey } = parsed.data.options;

    try {
      const upstream = await axios.get(`${baseURL.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: PROBE_TIMEOUT_MS,
      });
      const ids = extractModelIds(upstream.data);
      if (!ids) {
        res.status(502).json({ message: 'upstream 응답에서 모델 목록을 인식할 수 없습니다.' });
        return;
      }
      res.status(200).json({ models: ids.map((id) => ({ id })) });
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      console.error('[models-list] 프로브 실패:', status ? `upstream ${status}` : e instanceof Error ? e.message : String(e));
      res.status(502).json({ message: '모델 목록 조회에 실패했습니다.' });
    }
  });

  // #873: 저장된 anthropic 토큰으로 Anthropic Models API(GET /v1/models)를 실시간 조회한다.
  // 구독 OAuth 토큰(sk-ant-oat)도 Bearer 로 조회 가능함을 실측 확인 → 정적 목록 하드코딩 대신 최신 모델을 자동 노출.
  // token 은 응답/로그에 절대 노출하지 않는다.
  router.post('/models/anthropic/list', async (req: Request, res: Response): Promise<void> => {
    const parsed = anthropicRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    try {
      const client = anthropicClientFor(parsed.data.token);
      const models: { id: string; label: string }[] = [];
      // 응답은 최신 출시순 — 순서를 그대로 유지해 드롭다운 상단에 최신 모델이 오게 한다.
      for await (const m of client.models.list({ limit: 100 })) {
        models.push({ id: m.id, label: m.display_name });
      }
      if (models.length === 0) {
        res.status(502).json({ message: 'Anthropic 모델 목록이 비어 있습니다.' });
        return;
      }
      res.status(200).json({ models });
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? e.status : undefined;
      console.error('[models-anthropic] 조회 실패:', status ? `upstream ${status}` : e instanceof Error ? e.message : String(e));
      res.status(502).json({ message: 'Anthropic 모델 목록 조회에 실패했습니다.' });
    }
  });

  return router;
}
