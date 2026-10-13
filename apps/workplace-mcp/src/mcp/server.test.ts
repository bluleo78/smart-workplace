// src/mcp/server.test.ts — 공유 도구가 content 블록(이미지)을 돌려줘도 /mcp 응답에 그대로 실리는지 MCP 클라이언트 왕복으로 확인(WP-345).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SharedTool } from '@smart-workplace/mcp-tools-shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const image = { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' };
// 도구 집계만 가짜로 바꾼다 — 등록·응답 변환은 실제 buildMcpServer 코드를 탄다.
const buildUserToolsSpy = vi.fn();
vi.mock('../tools/index.js', () => {
  const tools: SharedTool[] = [
    { name: 'fake_image', description: 'd', inputSchema: z.object({}), app: 'issue', kind: 'read', handler: async () => [{ type: 'text', text: '첨부:' }, image] },
    { name: 'fake_text', description: 'd', inputSchema: z.object({}), app: 'issue', kind: 'read', handler: async () => '{"ok":true}' },
  ];
  return {
    buildUserTools: (...args: unknown[]) => {
      buildUserToolsSpy(...args);
      return tools;
    },
  };
});

import { buildMcpServer, principalKindOf } from './server.js';

async function call(name: string) {
  const server = buildMcpServer('http://api.test', 'swp_t');
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await client.callTool({ name, arguments: {} });
  } finally {
    await client.close();
  }
}

describe('buildMcpServer — 공유 도구 반환 타입 (WP-345)', () => {
  it('이미지 블록 배열을 그대로 응답 content 에 싣는다', async () => {
    const res = await call('fake_image');
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: 'text', text: '첨부:' }, image]);
  });

  it('문자열 반환은 text 블록 하나(기존 동작)', async () => {
    const res = await call('fake_text');
    expect(res.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });
});

describe('접속 주체 종류 (WP-372)', () => {
  it('토큰 접두사로 판별한다 — ak_ 는 AGENT, swp_ 는 HUMAN', () => {
    expect(principalKindOf('ak_abc')).toBe('AGENT');
    expect(principalKindOf('swp_abc')).toBe('HUMAN');
  });

  it('도구 등록(buildUserTools)에 principalKind 를 넘긴다', () => {
    buildUserToolsSpy.mockClear();
    buildMcpServer('http://api.test', 'ak_k');
    expect(buildUserToolsSpy.mock.calls[0][2]).toEqual({ principalKind: 'AGENT' });
    buildUserToolsSpy.mockClear();
    buildMcpServer('http://api.test', 'swp_k');
    expect(buildUserToolsSpy.mock.calls[0][2]).toEqual({ principalKind: 'HUMAN' });
  });
});
