// WP-596: 모델 서버 주소 SSRF 가드 — 내부 대역 판정·IP 리터럴 차단·운영자 허용 목록·접속 직전 DNS 가드.
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertModelHostAllowed,
  BlockedModelHostError,
  guardedLookup,
  isInternalAddress,
} from './model-url-guard.js';

afterEach(() => {
  delete process.env.MODEL_URL_ALLOWED_HOSTS;
});

describe('isInternalAddress', () => {
  it('루프백·사설·링크로컬(메타데이터)·CGNAT·미지정·멀티캐스트는 내부', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
      expect(isInternalAddress(ip), ip).toBe(true);
    }
  });

  it('IPv6 루프백·ULA·링크로컬·IPv4 매핑·NAT64 는 내부', () => {
    for (const ip of ['::1', '::', 'fd00::1', 'fc12::5', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1']) {
      expect(isInternalAddress(ip), ip).toBe(true);
    }
  });

  it('공인 주소는 내부가 아니다', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isInternalAddress(ip), ip).toBe(false);
    }
  });
});

describe('assertModelHostAllowed', () => {
  it('내부 IP 리터럴·localhost 는 막는다', () => {
    for (const u of ['http://169.254.169.254/latest', 'https://127.0.0.1:8443/v1', 'http://[::1]:11434/v1', 'http://localhost:11434/v1', 'http://10.0.0.5/v1']) {
      expect(() => assertModelHostAllowed(new URL(u)), u).toThrow(BlockedModelHostError);
    }
  });

  it('공인 IP·이름은 여기서 통과(이름은 접속 직전 lookup 가드가 본다)', () => {
    expect(() => assertModelHostAllowed(new URL('https://8.8.8.8/v1'))).not.toThrow();
    expect(() => assertModelHostAllowed(new URL('https://api.openai.com/v1'))).not.toThrow();
  });

  it('운영자 허용 목록(MODEL_URL_ALLOWED_HOSTS)에 있는 호스트는 내부 주소여도 통과', () => {
    process.env.MODEL_URL_ALLOWED_HOSTS = ' 10.0.0.5 , LLM.corp.local ';
    expect(() => assertModelHostAllowed(new URL('http://10.0.0.5/v1'))).not.toThrow();
    expect(() => assertModelHostAllowed(new URL('http://10.0.0.6/v1'))).toThrow(BlockedModelHostError);
  });
});

describe('guardedLookup', () => {
  it('내부 주소로 풀리는 이름(localhost)은 접속 전에 막는다', async () => {
    await expect(guardedLookup('localhost', {})).rejects.toBeInstanceOf(BlockedModelHostError);
  });

  it('허용 목록의 이름은 내부 주소로 풀려도 통과', async () => {
    process.env.MODEL_URL_ALLOWED_HOSTS = 'localhost';
    const [entries] = await guardedLookup('localhost', {});
    expect(entries.length).toBeGreaterThan(0);
  });
});
