import { describe, expect, it, vi } from 'vitest';
import { buildHelpTools } from './help-tools.js';
import { resultText } from './mcp-content.js';
import type { HelpToolClient } from './tool-client.js';

/** 도움말 클라이언트 mock — 검색은 API 응답 모양({mode, results}), 절 조회는 절 상세를 돌려준다. */
function mockClient(): HelpToolClient {
  return {
    searchManual: vi.fn().mockResolvedValue({
      mode: 'HYBRID',
      results: [
        {
          chapter: '04-issues',
          sectionId: 'issue-create',
          label: '이슈 만들기',
          title: '이슈를 만든다',
          snippet: '새 이슈 버튼을 눌러…',
          path: ['이슈', '이슈 만들기'],
        },
      ],
    }),
    getManualSection: vi.fn().mockResolvedValue({
      id: 'issue-create',
      chapter: '04-issues',
      chapterTitle: '이슈',
      label: '이슈 만들기',
      title: '이슈를 만든다',
      path: ['이슈', '이슈 만들기'],
      markdown: '본문 figure:issue-new',
      figures: [{ id: 'issue-new', alt: '새 이슈', marks: [{ n: 1, label: '새 이슈 버튼' }] }],
      links: ['05-projects#members'],
    }),
  };
}

const manual = (c: HelpToolClient) => buildHelpTools(c).find((t) => t.name === 'manual')!;

describe('buildHelpTools (WP-1510)', () => {
  it('manual 도구 하나 — 읽기 도구이고 help 앱에 속한다', () => {
    const tools = buildHelpTools(mockClient());
    expect(tools.map((t) => t.name)).toEqual(['manual']);
    expect(tools[0]).toMatchObject({ kind: 'read', app: 'help' });
  });

  it('search → searchManual(query) 를 부르고 {results:[{id,path,title,summary}]} 로 줄인다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await manual(c).handler({ action: 'search', query: '이슈 만들기' })));
    expect(c.searchManual).toHaveBeenCalledWith('이슈 만들기');
    expect(out).toEqual({
      results: [{ id: 'issue-create', path: ['이슈', '이슈 만들기'], title: '이슈를 만든다', summary: '새 이슈 버튼을 눌러…' }],
    });
  });

  it('search 결과가 비어도 {results:[]} 를 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.searchManual).mockResolvedValue({ mode: 'KEYWORD', results: [] });
    expect(JSON.parse(resultText(await manual(c).handler({ action: 'search', query: '없는 말' })))).toEqual({ results: [] });
  });

  it('get → getManualSection(id) 결과를 그대로(그림 표식 포함) 돌려준다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await manual(c).handler({ action: 'get', id: '04-issues#issue-create' })));
    expect(c.getManualSection).toHaveBeenCalledWith('04-issues#issue-create');
    expect(out).toEqual(await c.getManualSection('issue-create'));
    expect(out.figures[0].marks).toEqual([{ n: 1, label: '새 이슈 버튼' }]);
  });

  it('action 이 없거나 모르는 값, search 에 query 없음, get 에 id 없음은 거절하고 API 를 부르지 않는다', async () => {
    const c = mockClient();
    const t = manual(c);
    await expect(t.handler({})).rejects.toThrow();
    await expect(t.handler({ action: 'list' })).rejects.toThrow();
    await expect(t.handler({ action: 'search' })).rejects.toThrow();
    await expect(t.handler({ action: 'search', query: '' })).rejects.toThrow();
    await expect(t.handler({ action: 'get' })).rejects.toThrow();
    await expect(t.handler({ action: 'get', query: '이슈' })).rejects.toThrow();
    expect(c.searchManual).not.toHaveBeenCalled();
    expect(c.getManualSection).not.toHaveBeenCalled();
  });

  it('공백만 있는 query·id 는 거절하고, 앞뒤 공백은 떼어 API 에 넘긴다', async () => {
    const c = mockClient();
    const t = manual(c);
    // 공백만이면 빈 값과 같다 — 빈 검색·`/sections/%20` 조회를 보내지 않는다
    await expect(t.handler({ action: 'search', query: '   ' })).rejects.toThrow();
    await expect(t.handler({ action: 'get', id: ' \t' })).rejects.toThrow();
    expect(c.searchManual).not.toHaveBeenCalled();
    expect(c.getManualSection).not.toHaveBeenCalled();

    await t.handler({ action: 'search', query: '  이슈 만들기 ' });
    expect(c.searchManual).toHaveBeenCalledWith('이슈 만들기');
    await t.handler({ action: 'get', id: ' home.widget ' });
    expect(c.getManualSection).toHaveBeenCalledWith('home.widget');
  });
});
