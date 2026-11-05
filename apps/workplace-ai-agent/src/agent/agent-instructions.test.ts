// WP-1368: AI 의 지시 블록 — 시스템 프롬프트 뒤에 붙는지, 비었을 때 안 붙는지, 조회 실패가 실행을 막지 않는지 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_INSTRUCTIONS_HEADER,
  AGENT_INSTRUCTIONS_INTRO,
  fetchAgentInstructions,
  withAgentInstructions,
} from './agent-instructions.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

// getMember 만 가진 공유 도구 클라이언트를 돌려주는 목 — 어떤 agentId 로 불렸는지 함께 본다.
function clientWith(getMember: ReturnType<typeof vi.fn>) {
  const toolClient = vi.fn(() => ({ getMember }));
  return { client: { toolClient } as unknown as WorkplaceApiClient, toolClient };
}

describe('withAgentInstructions', () => {
  it('지시가 있으면 시스템 프롬프트 맨 뒤에 머리말·안내·지시 본문(앞뒤 공백 제거) 블록을 붙인다', () => {
    const out = withAgentInstructions('기본 프롬프트', '  다른 서비스를 참고한다\n코멘트는 짧게  ');
    expect(out).toBe(
      `기본 프롬프트\n\n${AGENT_INSTRUCTIONS_HEADER}\n${AGENT_INSTRUCTIONS_INTRO}\n\n다른 서비스를 참고한다\n코멘트는 짧게`,
    );
  });

  // WP-1368: 머리말·안내는 작성자(관리자/주인)를 가리지 않는 중립 문구다 — 개인 비서의 지시는 주인이 쓴다.
  it('지시 블록은 작성자(관리자)를 말하지 않는다', () => {
    expect(withAgentInstructions('기본 프롬프트', '짧게 답한다')).not.toContain('관리자');
  });

  it.each([null, undefined, '', '   \n\t '])('지시가 %j 이면 프롬프트를 그대로 돌려준다', (v) => {
    expect(withAgentInstructions('기본 프롬프트', v)).toBe('기본 프롬프트');
  });
});

describe('fetchAgentInstructions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('실행 주체 자신(agentId)을 조회해 저장된 지시를 그대로 돌려준다', async () => {
    const getMember = vi.fn().mockResolvedValue({ userId: 201, instructions: '짧게 답한다' });
    const { client, toolClient } = clientWith(getMember);
    await expect(fetchAgentInstructions(client, 201, 'tag')).resolves.toBe('짧게 답한다');
    expect(toolClient).toHaveBeenCalledWith(201);
    expect(getMember).toHaveBeenCalledWith(201);
  });

  it.each([null, undefined])('지시가 %j 이면 null', async (v) => {
    const { client } = clientWith(vi.fn().mockResolvedValue({ userId: 201, instructions: v }));
    await expect(fetchAgentInstructions(client, 201, 'tag')).resolves.toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  // 공백뿐인 지시는 그대로 돌려주고, 블록을 붙이지 않는 판단은 withAgentInstructions 가 한다.
  it('공백뿐인 지시는 그대로 돌려주고 withAgentInstructions 가 블록을 붙이지 않는다', async () => {
    const { client } = clientWith(vi.fn().mockResolvedValue({ userId: 201, instructions: '   ' }));
    const instructions = await fetchAgentInstructions(client, 201, 'tag');
    expect(instructions).toBe('   ');
    expect(withAgentInstructions('기본 프롬프트', instructions)).toBe('기본 프롬프트');
  });

  it('조회가 실패하면 경고를 한 번 남기고 null — 던지지 않는다', async () => {
    const { client } = clientWith(vi.fn().mockRejectedValue(new Error('500')));
    await expect(fetchAgentInstructions(client, 201, 'agent:x')).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledOnce();
    expect(vi.mocked(console.warn).mock.calls[0][1]).toMatchObject({ agentId: 201, logTag: 'agent:x' });
  });
});
