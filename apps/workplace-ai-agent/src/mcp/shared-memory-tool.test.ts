// WP-386 remember_shared_memory — 대행 요청·결과 이벤트 모양·오류 코드별 안내(개인 메모리로 돌릴지·공간을 물을지·실패를 알릴지).
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { parseMemoryToolResult } from './memory-tools.js';
import { buildSharedMemoryTool, rememberSharedMemoryInput, SHARED_TOOL_MESSAGES } from './shared-memory-tool.js';

const USER = 42;
const SID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';

function apiError(status: number, code: string, message = '사유'): AxiosError {
  const response = { status, data: { status, message, errors: { code } }, headers: {}, config: { headers: new AxiosHeaders() }, statusText: '' } as AxiosResponse;
  return new AxiosError(`API 오류 ${status}: ${message}`, 'ERR_BAD_REQUEST', undefined, undefined, response);
}

function setup(homeSessionId: string | null = SID) {
  const c = { requestSharedMemory: vi.fn() };
  const tool = buildSharedMemoryTool(c as unknown as WorkplaceApiClient, USER, homeSessionId ?? undefined);
  return { c, tool };
}

describe('remember_shared_memory (WP-386)', () => {
  it('설명: 팀 규칙으로 기억해 달라고 할 때만, 조직은 아님, 공간이 없으면 묻기', () => {
    const { tool } = setup();
    expect(tool.name).toBe('remember_shared_memory');
    expect(tool.description).toContain('팀·프로젝트·스페이스 규칙으로 기억해');
    expect(tool.description).toContain('어느 프로젝트·노트 스페이스인지 먼저 묻고');
    expect(tool.description).toContain('조직 지침');
    expect(rememberSharedMemoryInput.shape.space.description).toContain('생략하면 지금 공간');
    expect(tool.annotations).toBeUndefined();
  });

  it('지금 공간 → 대행 POST(이 대화 세션) → shared 결과 이벤트(결과 줄로 파싱된다)', async () => {
    const { c, tool } = setup();
    c.requestSharedMemory.mockResolvedValue({
      changeId: 5, memoryId: 9, spaceType: 'PROJECT', spaceId: 3, spaceName: 'Smart Workplace(WP)', content: '배포는 API 먼저 한다',
    });
    const out = await tool.handler({ content: '배포는 API 먼저 한다' });
    expect(c.requestSharedMemory).toHaveBeenCalledWith(USER, { content: '배포는 API 먼저 한다', sessionId: SID });
    const event = { action: 'shared', changeId: 5, memoryId: 9, spaceName: 'Smart Workplace(WP)', content: '배포는 API 먼저 한다' };
    expect(JSON.parse(out as string)).toEqual(event);
    expect(parseMemoryToolResult(out as string)).toEqual(event);
  });

  it('공간 이름을 주면 그대로, "current"·빈 값은 생략(지금 공간)', async () => {
    const { c, tool } = setup(null);
    c.requestSharedMemory.mockResolvedValue({ changeId: 1, memoryId: 1, spaceType: 'WIKI_SPACE', spaceId: 2, spaceName: '개발팀 노트', content: 'x' });
    await tool.handler({ content: 'x', space: ' 개발팀 노트 ' });
    expect(c.requestSharedMemory).toHaveBeenLastCalledWith(USER, { content: 'x', space: '개발팀 노트' });
    await tool.handler({ content: 'x', space: 'current' });
    expect(c.requestSharedMemory).toHaveBeenLastCalledWith(USER, { content: 'x' });
    await tool.handler({ content: 'x', space: '   ' });
    expect(c.requestSharedMemory).toHaveBeenLastCalledWith(USER, { content: 'x' });
  });

  it('422 개인적 내용 → 켜져 있으면 개인 메모리로·꺼져 있으면 저장하지 않는 안내(결과 줄 없음)', async () => {
    const { c, tool } = setup();
    c.requestSharedMemory.mockRejectedValue(apiError(422, 'SHARED_MEMORY_PERSONAL'));
    const out = (await tool.handler({ content: '나는 금요일마다 재택한다' })) as string;
    expect(out).toBe(SHARED_TOOL_MESSAGES.personal);
    expect(out).toContain('remember_memory');
    // 메모리 꺼짐 줄이 있으면 개인 메모리로 돌리지 않고, 개인 메모리가 꺼져 있어 저장하지 않았다고 알린다(WP-386 통제자 판정 P6).
    expect(out).toContain('"메모리 꺼짐" 줄이 있으면 저장하지 말고');
    expect(out).toContain('개인적인 내용 같고 개인 메모리가 꺼져 있어 아무것도 저장하지 않았어요');
    expect(parseMemoryToolResult(out)).toBeNull();
  });

  it('503_이면_개인_메모리로_돌리지_않는다', async () => {
    const { c, tool } = setup();
    c.requestSharedMemory.mockRejectedValue(apiError(503, 'SHARED_MEMORY_CHECK_UNAVAILABLE'));
    const out = (await tool.handler({ content: '배포는 API 먼저 한다' })) as string;
    expect(out).toBe(SHARED_TOOL_MESSAGES.unavailable);
    expect(out).toContain('지금은 공용 메모리에 저장하지 못했어요');
    expect(out).toContain('개인 메모리로 대신 저장하지 않는다');
    expect(out).not.toContain('remember_memory 로 저장');
    expect(parseMemoryToolResult(out)).toBeNull();
  });

  it('400 공간을 못 정함 → 서버가 준 후보와 함께 어느 공간인지 물으라는 안내', async () => {
    const { c, tool } = setup();
    c.requestSharedMemory.mockRejectedValue(apiError(400, 'SHARED_MEMORY_SPACE_UNRESOLVED', '어느 공간인지 알 수 없어요. 후보: WP, 개발팀 노트'));
    const out = (await tool.handler({ content: 'x' })) as string;
    expect(out).toContain(SHARED_TOOL_MESSAGES.spaceUnresolved);
    expect(out).toContain('후보: WP, 개발팀 노트');
    expect(parseMemoryToolResult(out)).toBeNull();
  });

  it('403(조직·권한 없음)·409 가득 참 → 안내, 그 밖의 오류는 던진다', async () => {
    const { c, tool } = setup();
    c.requestSharedMemory.mockRejectedValueOnce(apiError(403, 'SHARED_MEMORY_FORBIDDEN', '조직 지침은 관리자가 설정에서 직접 추가해요'));
    expect(await tool.handler({ content: 'x', space: '조직' })).toBe(`${SHARED_TOOL_MESSAGES.forbidden} (조직 지침은 관리자가 설정에서 직접 추가해요)`);
    c.requestSharedMemory.mockRejectedValueOnce(apiError(409, 'SHARED_MEMORY_FULL', 'WP 공용 메모리가 가득 찼어요'));
    expect(await tool.handler({ content: 'x' })).toBe(`${SHARED_TOOL_MESSAGES.full} (WP 공용 메모리가 가득 찼어요)`);
    c.requestSharedMemory.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(tool.handler({ content: 'x' })).rejects.toThrow('ECONNREFUSED');
  });

  // 400 INVALID(빈 문장·300자 초과)·404 NOT_FOUND(없거나 접근 못 하는 공간)는 던지지 않고 안내로 돌려준다 — 결과 줄은 생기지 않는다.
  it('400 내용 부적합·404 공간 없음 → 던지지 않고 안내(결과 줄 없음)', async () => {
    const { c, tool } = setup();
    c.requestSharedMemory.mockRejectedValueOnce(apiError(400, 'SHARED_MEMORY_INVALID', '내용은 1~300자로 적어 주세요.'));
    const invalid = (await tool.handler({ content: 'x' })) as string;
    expect(invalid).toBe(`${SHARED_TOOL_MESSAGES.invalid} (내용은 1~300자로 적어 주세요.)`);
    expect(invalid).toContain('300자를 넘는다');
    expect(parseMemoryToolResult(invalid)).toBeNull();
    c.requestSharedMemory.mockRejectedValueOnce(apiError(404, 'SHARED_MEMORY_NOT_FOUND', '찾을 수 없어요.'));
    const missing = (await tool.handler({ content: 'x', space: '없는 공간' })) as string;
    expect(missing).toBe(`${SHARED_TOOL_MESSAGES.notFound} (찾을 수 없어요.)`);
    expect(missing).toContain('접근할 수 없다');
    expect(parseMemoryToolResult(missing)).toBeNull();
  });

  // 300자(코드포인트) 상한은 서버와 같게 세어 핸들러가 막는다 — 이모지 300자는 통과, 301자는 API 를 부르지 않고 안내.
  it('301자는 API 를 부르지 않고 안내, 이모지 300자는 그대로 보낸다', async () => {
    const { c, tool } = setup();
    const tooLong = await tool.handler({ content: '가'.repeat(301) });
    expect(tooLong).toBe(SHARED_TOOL_MESSAGES.invalid);
    expect(c.requestSharedMemory).not.toHaveBeenCalled();
    expect(parseMemoryToolResult(tooLong as string)).toBeNull();

    c.requestSharedMemory.mockResolvedValue({ changeId: 1, memoryId: 1, spaceType: 'PROJECT', spaceId: 3, spaceName: 'WP', content: 'x' });
    await tool.handler({ content: '😀'.repeat(300) });
    expect(c.requestSharedMemory).toHaveBeenCalledTimes(1);
  });
});
