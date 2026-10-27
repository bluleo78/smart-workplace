// 서버 기동 설정 — keep-alive 시간이 앞단 nginx 보다 길어야 유휴 연결 재사용 경쟁으로 502 가 나지 않는다(WP-1013).
import { describe, expect, it } from 'vitest';

import { createApp, listen } from './index.js';

/** ingress-nginx 의 upstream-keepalive-timeout 기본값. 컨트롤러 전역 설정이라 deploy/helm 밖이다(ingress.yaml 주석 참고). */
const NGINX_UPSTREAM_KEEPALIVE_MS = 60_000;

describe('listen', () => {
  it('유휴 연결을 nginx 보다 늦게 닫고, headersTimeout 은 keepAliveTimeout 보다 크다', async () => {
    const server = listen(createApp({ apiBaseUrl: 'http://api.test' }), 0);
    try {
      expect(server.keepAliveTimeout).toBeGreaterThan(NGINX_UPSTREAM_KEEPALIVE_MS);
      expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
