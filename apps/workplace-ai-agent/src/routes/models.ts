// 모델 목록 조회 라우트.
//  - POST /models/list (Task10): OpenAI 호환 baseURL+apiKey 프로브 — 등록 전 검증과 opencode 드롭다운에서 재사용.
//  - POST /models/anthropic/list (#873): 저장된 anthropic 토큰으로 Anthropic Models API 실시간 조회.
// WP-1322: 두 경로 모두 모델별 「생각의 깊이」 지원 단계(efforts: LOW~MAX 중 낮은 순)를 싣는다. 모르면 efforts 를 빼고 보낸다(웹이 provider 별
// 기본으로 보인다 — Claude 는 LOW~HIGH, OpenAI 호환은 「설정 안 함」만).
import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { assertModelHostAllowed, BlockedModelHostError, MODEL_REQUEST_GUARD } from '../clients/model-url-guard.js';
import { lookupOpencodeEfforts, type EffortsMap } from '../agent/opencode-efforts.js';
import { effortsList, type EffortLevel } from '../agent/thinking.js';

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
  // WP-1322: 연결의 provider 패키지 — opencode 가 어떤 variant 를 만들지 정하는 데 쓴다. 없으면(구 api·미지정) OpenAI 호환 기본.
  npm: z.string().min(1).nullish(),
  // WP-1322: true 일 때만 생각의 깊이 단계를 묻는다 — opencode 를 잠깐 띄워 첫 조회가 수 초 늘므로 api 의 비서 설정 드롭다운(등록 후 모델
  // 목록)만 켠다. 등록 전 검증 프로브는 빠르게 목록만 받는다.
  withEfforts: z.boolean().optional(),
});

/** 내부 단계(소문자) → 웹·api 계약의 대문자 단계 — 대문자로는 이 HTTP 경계에서만 바꾼다. */
const toContractLevels = (levels: readonly EffortLevel[]): string[] => levels.map((l) => l.toUpperCase());

/**
 * Anthropic Models API 의 capabilities.effort → 지원 단계 목록. capabilities 가 없거나(null — 구 모델·권한에 따라 비어 옴) effort 정보가
 * 없으면 undefined(모름) — 웹이 Claude 기본 LOW~HIGH 로 보인다. effort 를 받지 않는 모델(전부 supported:false)은 빈 목록.
 */
export function anthropicEfforts(capabilities: unknown): string[] | undefined {
  const effort = (capabilities as { effort?: Record<string, { supported?: unknown } | null | undefined> | null } | null)?.effort;
  if (!effort || typeof effort !== 'object') return undefined;
  return toContractLevels(effortsList(Object.entries(effort).filter(([, v]) => v?.supported === true).map(([k]) => k)));
}

/** 라우터 의존 — 테스트가 opencode 를 띄우지 않게 바꿔 끼운다. */
export interface ModelsRouterDeps {
  lookupOpencodeEfforts: (npm: string | null | undefined, modelIds: string[]) => Promise<EffortsMap>;
}

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

/** 내부망 차단에 걸린 실패인가 — IP 리터럴 검사는 그대로, 접속 직전 lookup 가드는 axios 오류의 cause 로 온다. */
function isBlockedHost(e: unknown): boolean {
  return e instanceof BlockedModelHostError || (axios.isAxiosError(e) && e.cause instanceof BlockedModelHostError);
}

export function createModelsRouter(deps: ModelsRouterDeps = { lookupOpencodeEfforts }): Router {
  const router = Router();

  // 등록 전/후 공통 모델 프로브 — apiKey 는 응답/로그에 절대 노출하지 않는다.
  router.post('/models/list', async (req: Request, res: Response): Promise<void> => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { baseURL, apiKey } = parsed.data.options;
    const { npm, withEfforts } = parsed.data;

    try {
      // WP-596: 내부망 주소(IP 리터럴은 여기서, 이름은 접속 직전 lookup 가드에서)로는 나가지 않고 리다이렉트도 따라가지 않는다.
      assertModelHostAllowed(new URL(baseURL));
      const upstream = await axios.get(`${baseURL.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: PROBE_TIMEOUT_MS,
        ...MODEL_REQUEST_GUARD,
      });
      const ids = extractModelIds(upstream.data);
      if (!ids) {
        res.status(502).json({ message: 'upstream 응답에서 모델 목록을 인식할 수 없습니다.' });
        return;
      }
      // WP-1322: 지원 단계는 요청했을 때만, best-effort — 알아내지 못한 모델은 efforts 를 뺀다(웹은 「설정 안 함」만). 예외는 삼킨다.
      const efforts = withEfforts ? await deps.lookupOpencodeEfforts(npm, ids).catch(() => null) : null;
      res.status(200).json({
        models: ids.map((id) => {
          const e = efforts?.get(id);
          return e ? { id, efforts: toContractLevels(e) } : { id };
        }),
      });
    } catch (e) {
      if (isBlockedHost(e)) {
        res.status(400).json({ message: '내부망 주소로는 모델 서버에 접속할 수 없습니다.' });
        return;
      }
      if (e instanceof TypeError && !axios.isAxiosError(e)) {
        // new URL() 형식 오류
        res.status(400).json({ message: '올바르지 않은 baseURL 형식입니다.' });
        return;
      }
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
      const models: { id: string; label: string; efforts?: string[] }[] = [];
      // 응답은 최신 출시순 — 순서를 그대로 유지해 드롭다운 상단에 최신 모델이 오게 한다.
      for await (const m of client.models.list({ limit: 100 })) {
        const efforts = anthropicEfforts(m.capabilities);
        models.push({ id: m.id, label: m.display_name, ...(efforts ? { efforts } : {}) });
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
