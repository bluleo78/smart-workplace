// Task10: OpenAI 호환 baseURL+apiKey 로 모델 목록을 프로브한다.
// 등록 전 자격증명 검증(admin/개인 probe)과 등록 후 모델 드롭다운(opencode) 양쪽에서 재사용.
import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import { z } from 'zod';

const PROBE_TIMEOUT_MS = 10_000;

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

  return router;
}
