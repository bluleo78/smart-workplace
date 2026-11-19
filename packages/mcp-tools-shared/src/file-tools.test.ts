import { describe, expect, it, vi } from 'vitest';
import { buildFileTools, UPLOAD_FILE_CONTENT_DESCRIPTION, UPLOAD_FILE_SOURCE_DESCRIPTION } from './file-tools.js';
import { resultText } from './mcp-content.js';
import type { FileToolClient } from './tool-client.js';

/** 스테이징 파일 클라이언트 mock(WP-421) — 서버 StagedFileResponse·StagedUploadLinkResponse 모양 그대로. */
function mockClient(): FileToolClient {
  return {
    createStagedTextFile: vi.fn().mockResolvedValue({
      fileId: 901, name: '요약.md', sizeBytes: 8, mimeType: 'text/markdown', expiresAt: '2026-10-17T05:00:00Z',
    }),
    createStagedUploadLink: vi.fn().mockResolvedValue({
      url: 'https://w.example/api/v1/public/staged-files/su_abc', method: 'PUT', expiresAt: '2026-10-16T05:10:00Z',
      maxBytes: 26214400, name: '보고서.pdf', singleUse: true,
    }),
    // WP-1705: 읽을 수 있는 첨부를 스테이징 파일로 복사 — 응답은 같은 StagedFileResponse.
    copyToStagedFile: vi.fn().mockResolvedValue({ fileId: 77, name: '화면.png', sizeBytes: 16, mimeType: 'image/png', expiresAt: 't' }),
  };
}

const uploadFile = (c: FileToolClient) => buildFileTools(c).find((t) => t.name === 'upload_file')!;

describe('buildFileTools (WP-421)', () => {
  it('upload_file 하나 — issue·messaging·wiki 앱의 쓰기(추가만, 비멱등)', () => {
    const tools = buildFileTools(mockClient());
    expect(tools.map((t) => t.name)).toEqual(['upload_file']);
    const [t] = tools;
    expect(t.app).toEqual(['issue', 'messaging', 'wiki']);
    expect(t.kind).toBe('write');
    expect(t.kind === 'read' ? undefined : t.hints).toEqual({ destructive: false, idempotent: false });
    // 설명은 content 모드 부분(AI Chat 판이 그대로 쓴다) + 링크 부분이다.
    expect(t.description.startsWith(UPLOAD_FILE_CONTENT_DESCRIPTION)).toBe(true);
    expect(t.description).toContain('curl -T <file> "<uploadUrl>"');
    // WP-1634: 이슈 본문·댓글에는 자리표시로 원하는 자리에 넣을 수 있다고 알린다(AI Chat 판도 같은 content 부분을 쓴다).
    expect(UPLOAD_FILE_CONTENT_DESCRIPTION).toContain('![alt](file:<fileId>) in issue/comment body');
  });

  it('upload_file: content 가 있으면(빈 문자열 포함) 텍스트로 만든다 — 링크는 만들지 않는다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await uploadFile(c).handler({ name: '요약.md', content: '# 요약' })));
    expect(c.createStagedTextFile).toHaveBeenCalledWith('요약.md', '# 요약');
    expect(out).toEqual({ fileId: 901, name: '요약.md', sizeBytes: 8, mimeType: 'text/markdown', expiresAt: '2026-10-17T05:00:00Z' });
    // 빈 문자열은 빈 파일이다 — 진릿값으로 가르면 링크로 새어 나간다.
    await uploadFile(c).handler({ name: '빈.txt', content: '' });
    expect(c.createStagedTextFile).toHaveBeenLastCalledWith('빈.txt', '');
    expect(c.createStagedUploadLink).not.toHaveBeenCalled();
  });

  it('upload_file: content 가 없으면 링크 뷰(howTo·note 포함, 서버의 낯선 필드는 빠짐)', async () => {
    const c = mockClient();
    vi.mocked(c.createStagedUploadLink).mockResolvedValue({
      url: 'https://w.example/api/v1/public/staged-files/su_abc', method: 'PUT', expiresAt: '2026-10-16T05:10:00Z',
      maxBytes: 26214400, name: '보고서.pdf', singleUse: true, userId: 77, tokenHash: 'abc',
    } as never);
    const out = JSON.parse(resultText(await uploadFile(c).handler({ name: '보고서.pdf' })));
    expect(c.createStagedUploadLink).toHaveBeenCalledWith('보고서.pdf');
    expect(c.createStagedTextFile).not.toHaveBeenCalled();
    expect(Object.keys(out).sort()).toEqual(['expiresAt', 'howTo', 'maxBytes', 'method', 'name', 'note', 'singleUse', 'uploadUrl']);
    expect(out).toMatchObject({
      uploadUrl: 'https://w.example/api/v1/public/staged-files/su_abc', method: 'PUT', expiresAt: '2026-10-16T05:10:00Z',
      maxBytes: 26214400, name: '보고서.pdf', singleUse: true,
      howTo: 'curl -T <local file> "https://w.example/api/v1/public/staged-files/su_abc"',
    });
    // 안내: 한 번만·Content-Type 금지·응답의 fileId 를 쓰고·24시간 안에 붙이고·실패하면 새 링크.
    expect(out.note).toMatch(/한 번만/);
    expect(out.note).toMatch(/Content-Type/);
    expect(out.note).toMatch(/fileId/);
    expect(out.note).toMatch(/24시간/);
    expect(out.note).toMatch(/새 링크/);
    // WP-1634: 이슈 본문·댓글 자리표시 안내.
    expect(out.note).toContain('![설명](file:<fileId>)');
    expect(out.note).toContain('둘 중 하나만 쓰면 됩니다');
    expect(out.note).toContain('이슈 만들기·고치기에서는 둘 다 써도 본문 처리로 한 번만 붙습니다');
  });

  it('upload_file: content: null 도 생략으로 본다(링크 모드)', async () => {
    const c = mockClient();
    await uploadFile(c).handler({ name: '보고서.pdf', content: null });
    expect(c.createStagedUploadLink).toHaveBeenCalledWith('보고서.pdf');
    expect(c.createStagedTextFile).not.toHaveBeenCalled();
  });

  it('upload_file: 이름은 1~255자', async () => {
    const c = mockClient();
    await expect(uploadFile(c).handler({ name: '', content: 'x' })).rejects.toThrow();
    await expect(uploadFile(c).handler({ name: 'a'.repeat(256), content: 'x' })).rejects.toThrow();
    expect(c.createStagedTextFile).not.toHaveBeenCalled();
  });

  // AI Chat 판(allowUploadLink: false) — 셸이 없어 링크를 쓸 수 없다. content 가 없으면(null 포함) API 없이 오류, 설명은 content 모드만.
  it('upload_file(allowUploadLink: false): content 모드만 — 링크 요청은 API 없이 거절, 설명에 링크 안내 없음', async () => {
    const c = mockClient();
    const t = buildFileTools(c, { allowUploadLink: false })[0];
    await t.handler({ name: '빈.txt', content: '' });
    expect(c.createStagedTextFile).toHaveBeenCalledWith('빈.txt', '');
    await expect(t.handler({ name: '보고서.pdf' })).rejects.toThrow(/AI Chat 에서는 업로드 링크를 만들 수 없습니다/);
    await expect(t.handler({ name: '보고서.pdf', content: null })).rejects.toThrow(/AI Chat 에서는 업로드 링크를 만들 수 없습니다/);
    expect(c.createStagedUploadLink).not.toHaveBeenCalled();
    expect(t.description).toMatch(/^AI Chat 에서는/);
    // WP-1705: content 부분 뒤에 source 부분이 붙는다(복사 갈래는 AI Chat 에서도 쓸 수 있다).
    expect(t.description.endsWith(`${UPLOAD_FILE_CONTENT_DESCRIPTION} ${UPLOAD_FILE_SOURCE_DESCRIPTION}`)).toBe(true);
    expect(t.description).not.toMatch(/curl|uploadUrl|one-time upload link|maxBytes/);
  });

  // ── WP-1705: source 갈래 — 읽을 수 있는 첨부(이슈·이슈 챗·드라이브)를 서버에서 복사해 스테이징한다(read_file 과 같은 식별자). ──
  it('upload_file source: issue 첨부를 복사한다 — name 생략 가능, 응답은 StagedFile 그대로', async () => {
    const c = mockClient();
    const out = await uploadFile(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
    expect(c.copyToStagedFile).toHaveBeenCalledWith({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
    expect(JSON.parse(resultText(out))).toEqual({ fileId: 77, name: '화면.png', sizeBytes: 16, mimeType: 'image/png', expiresAt: 't' });
    expect(c.createStagedTextFile).not.toHaveBeenCalled();
    expect(c.createStagedUploadLink).not.toHaveBeenCalled();
  });

  it('upload_file source: name 을 주면 함께 보낸다(issue_chat·drive 도 같은 표로 필수 필드)', async () => {
    const c = mockClient();
    await uploadFile(c).handler({ source: 'issue_chat', issueKey: 'WP-1', messageId: 3, attachmentId: 5, name: '캡처.png' });
    expect(c.copyToStagedFile).toHaveBeenLastCalledWith({ source: 'issue_chat', issueKey: 'WP-1', messageId: 3, attachmentId: 5, name: '캡처.png' });
    await uploadFile(c).handler({ source: 'drive', driveFileId: 8, name: '캡처.png' });
    expect(c.copyToStagedFile).toHaveBeenLastCalledWith({ source: 'drive', driveFileId: 8, name: '캡처.png' });
  });

  it('upload_file source: 필수 식별자가 빠지면 API 를 부르지 않고 거절', async () => {
    const c = mockClient();
    await expect(uploadFile(c).handler({ source: 'issue_chat', issueKey: 'WP-1', attachmentId: 5 })).rejects.toThrow(/messageId/);
    await expect(uploadFile(c).handler({ source: 'drive' })).rejects.toThrow(/driveFileId/);
    expect(c.copyToStagedFile).not.toHaveBeenCalled();
  });

  it('upload_file source: 다른 source 의 식별자·content 와 함께 주면 거절', async () => {
    const c = mockClient();
    await expect(uploadFile(c).handler({ source: 'drive', driveFileId: 1, issueKey: 'WP-1' })).rejects.toThrow(/issueKey/);
    await expect(uploadFile(c).handler({ source: 'drive', driveFileId: 1, content: 'x' })).rejects.toThrow(/content/);
    expect(c.copyToStagedFile).not.toHaveBeenCalled();
    expect(c.createStagedTextFile).not.toHaveBeenCalled();
  });

  it('upload_file: source 없이 식별자만 주거나 name 이 없으면 거절', async () => {
    const c = mockClient();
    await expect(uploadFile(c).handler({ issueKey: 'WP-1', attachmentId: 5, name: 'a' })).rejects.toThrow(/source/);
    await expect(uploadFile(c).handler({ content: 'x' })).rejects.toThrow(/name/);
    expect(c.copyToStagedFile).not.toHaveBeenCalled();
    expect(c.createStagedTextFile).not.toHaveBeenCalled();
    expect(c.createStagedUploadLink).not.toHaveBeenCalled();
  });

  it('upload_file source: null 로 채운 쓰지 않는 인자는 생략으로 본다', async () => {
    const c = mockClient();
    await uploadFile(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 5, name: null, content: null, driveFileId: null, messageId: null });
    expect(c.copyToStagedFile).toHaveBeenCalledWith({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
  });

  it('upload_file(allowUploadLink: false): source 갈래는 허용하고, content·source 둘 다 없을 때만 링크 거절', async () => {
    const c = mockClient();
    const t = buildFileTools(c, { allowUploadLink: false })[0];
    await t.handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
    expect(c.copyToStagedFile).toHaveBeenCalledWith({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
    await expect(t.handler({ name: '보고서.pdf', source: null })).rejects.toThrow(/AI Chat 에서는 업로드 링크를 만들 수 없습니다.*source 로 복사/);
    expect(c.createStagedUploadLink).not.toHaveBeenCalled();
  });

  it('upload_file 설명: 두 판 모두 source 문장이 한 번 있다', () => {
    for (const allowUploadLink of [true, false]) {
      const d = buildFileTools(mockClient(), { allowUploadLink })[0].description;
      expect(d.split(UPLOAD_FILE_SOURCE_DESCRIPTION).length - 1).toBe(1);
    }
  });
});
