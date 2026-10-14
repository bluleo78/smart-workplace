import { describe, expect, it, vi } from 'vitest';

import { FileTooLargeError } from './attachment-read.js';
import { imageViewBlocks, originalImageBlocks, pageBlocks, pagesShape, viewBlocks } from './attachment-view.js';
import type { McpContent } from './mcp-content.js';
import type { FileBytes } from './tool-client.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const png = (over: Partial<FileBytes> = {}): FileBytes => ({ data: PNG, mimeType: 'image/png', ...over });

describe('pagesShape', () => {
  it('1부터, 1~3개. null 은 미지정', () => {
    const s = pagesShape.pages;
    expect(s.parse([1, 2, 3])).toEqual([1, 2, 3]);
    expect(s.parse(null)).toBeNull();
    expect(() => s.parse([0])).toThrow();
    expect(() => s.parse([])).toThrow();
    expect(() => s.parse([1, 2, 3, 4])).toThrow();
  });
});

describe('viewBlocks', () => {
  it('[설명 text, image] — 형식은 Content-Type 파라미터를 뗀 값', () => {
    expect(viewBlocks('"a.heic"', png({ mimeType: 'image/jpeg;charset=UTF-8' }))).toEqual([
      { type: 'text', text: '"a.heic" (image/jpeg, 4B)' },
      { type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/jpeg' },
    ]);
  });
});

describe('pageBlocks', () => {
  it('중복 페이지는 한 번만 받고, 쪽마다 [설명, image] 블록', async () => {
    const fetch = vi.fn().mockResolvedValue(png());
    const out = (await pageBlocks('"보고서.pdf"', [7, 7, 8], fetch)) as McpContent[];
    expect(fetch.mock.calls).toEqual([[7], [8]]);
    expect(out.map((b) => b.type)).toEqual(['text', 'image', 'text', 'image']);
    expect(out[0]).toEqual({ type: 'text', text: expect.stringContaining('7쪽') });
    expect(out[2]).toEqual({ type: 'text', text: expect.stringContaining('8쪽') });
  });

  // 코드 리뷰: 쪽을 차례로 받으면 3쪽이 세 배 걸린다 — 한꺼번에 요청하되 결과는 요청 순서로 싣는다.
  it('여러 쪽을 동시에 요청하고, 늦게 끝난 쪽이 있어도 결과는 요청 순서대로', async () => {
    const started: number[] = [];
    const release: Record<number, (v: FileBytes) => void> = {};
    const fetch = (n: number) =>
      new Promise<FileBytes>((resolve) => {
        started.push(n);
        release[n] = resolve;
      });
    const pending = pageBlocks('"a.pdf"', [3, 1, 2], fetch);
    // 첫 쪽이 끝나기 전에 세 쪽 모두 요청이 나갔다.
    await Promise.resolve();
    expect(started).toEqual([3, 1, 2]);
    release[2](png({ mimeType: 'image/jpeg' }));
    release[1](png());
    release[3](png({ pageCount: 9 }));
    const out = (await pending) as McpContent[];
    expect(out.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : ''))).toEqual([
      '"a.pdf" 3쪽(전체 9쪽) (image/png, 4B)',
      '"a.pdf" 1쪽 (image/png, 4B)',
      '"a.pdf" 2쪽 (image/jpeg, 4B)',
    ]);
  });

  it('일부 쪽만 실패하면 받은 쪽 이미지를 요청 순서로 싣고 실패 사유를 뒤에 붙인다', async () => {
    const out = (await pageBlocks('"a.pdf"', [5, 9, 4], async (n) => {
      if (n === 9) throw new Error('이 PDF 는 6쪽입니다.');
      await new Promise((r) => setTimeout(r, n === 5 ? 5 : 0));
      return png();
    })) as McpContent[];
    expect(out.map((b) => (b.type === 'text' ? b.text : b.type))).toEqual([
      '"a.pdf" 5쪽 (image/png, 4B)',
      'image',
      '"a.pdf" 4쪽 (image/png, 4B)',
      'image',
      '"a.pdf" 9쪽: 이 PDF 는 6쪽입니다.',
    ]);
  });

  // 코드 리뷰: /view 상한 초과는 원본이 아니라 변환한 이미지가 큰 것이다 — 사유 주어를 바로 쓴다.
  it('변환본이 다운로드 상한을 넘으면(FileTooLargeError) "변환한 이미지가" 로 알린다', async () => {
    const out = await pageBlocks('"a.pdf"', [1], async () => {
      throw new FileTooLargeError();
    });
    expect(out).toBe(`"a.pdf" 1쪽: 변환한 이미지가 ${new FileTooLargeError().maxBytes}B 를 넘어 받지 않았습니다.`);
  });

  it('서버가 알려 준 전체 쪽수(X-Page-Count)를 설명에 붙인다', async () => {
    const out = (await pageBlocks('"보고서.pdf"', [2], async () => png({ pageCount: 6 }))) as McpContent[];
    expect(out[0]).toEqual({ type: 'text', text: '"보고서.pdf" 2쪽(전체 6쪽) (image/png, 4B)' });
  });

  // 리뷰 M8: 모든 쪽이 같은 사유로 실패하면(403·404·415 등) 같은 문장을 되풀이하지 않고 한 줄로.
  it('같은 사유의 실패는 쪽 번호를 묶어 한 줄로', async () => {
    const out = await pageBlocks('"a.png"', [1, 2, 3], async () => {
      throw new Error('page 는 PDF 에만 쓸 수 있습니다.');
    });
    expect(out).toBe('"a.png" 1·2·3쪽: page 는 PDF 에만 쓸 수 있습니다.');
  });

  // 리뷰 M1: 프록시 502·504 HTML 같은 JSON 이 아닌 본문을 통째로 모델에 넘기지 않는다(describeApiError 와 같은 300자).
  it('JSON 이 아닌 긴 오류 본문은 잘라서 싣는다', async () => {
    const out = await pageBlocks('"a.pdf"', [1], async () => {
      throw Object.assign(new Error('Request failed with status code 502'), {
        response: { status: 502, data: `<html>${'x'.repeat(5000)}</html>` },
      });
    });
    expect(typeof out).toBe('string');
    expect(out).toContain('API 오류 502: <html>');
    expect((out as string).length).toBeLessThan(400);
  });

  it('같은 쪽 번호가 겹치면 한 번만 받는다', async () => {
    const fetch = vi.fn().mockResolvedValue(png());
    await pageBlocks('"a.pdf"', [1, 1, 2], fetch);
    expect(fetch.mock.calls.map(([n]) => n)).toEqual([1, 2]);
  });

  it('서버 오류(범위 밖 등)는 던지지 않고 메시지를 text 로 — 모델이 범위를 고쳐 다시 부르게', async () => {
    const out = await pageBlocks('"보고서.pdf"', [9], async () => {
      throw new Error('이 PDF 는 6쪽입니다. 1~6 사이 페이지를 지정하세요.');
    });
    expect(typeof out).toBe('string');
    expect(out).toContain('이 PDF 는 6쪽입니다. 1~6 사이 페이지를 지정하세요.');
  });

  it('axios 오류 모양(response.data)이면 서버 ErrorResponse 의 message 를 싣는다', async () => {
    const out = await pageBlocks('"a.pdf"', [1], async () => {
      throw Object.assign(new Error('Request failed with status code 422'), {
        response: { status: 422, data: { message: '파일을 열 수 없습니다(손상·암호).' } },
      });
    });
    expect(out).toContain('파일을 열 수 없습니다(손상·암호).');
  });

  it('일부 쪽만 실패하면 받은 쪽의 이미지와 실패한 쪽의 사유를 함께', async () => {
    const fetch = vi.fn(async (n: number) => {
      if (n === 7) throw new Error('이 PDF 는 6쪽입니다.');
      return png();
    });
    const out = (await pageBlocks('"a.pdf"', [6, 7], fetch)) as McpContent[];
    expect(out.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    expect(out[2]).toEqual({ type: 'text', text: expect.stringContaining('이 PDF 는 6쪽입니다.') });
  });
});

describe('imageViewBlocks', () => {
  it('변환본을 [설명, image] 블록으로 — 형식은 응답 Content-Type 에서 파라미터를 뗀 값', async () => {
    const view = vi.fn().mockResolvedValue(png({ mimeType: 'image/jpeg; charset=binary' }));
    const out = (await imageViewBlocks('"a.jpg"', view)) as McpContent[];
    expect(view).toHaveBeenCalledOnce();
    expect(out).toEqual([
      { type: 'text', text: '"a.jpg" (image/jpeg, 4B)' },
      { type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/jpeg' },
    ]);
  });

  it('변환 실패(서버 4xx·5xx)는 던지지 않고 사유를 text 로, 변환본이 상한을 넘으면 그 사유', async () => {
    const view = vi.fn().mockRejectedValue(new Error('PDF·이미지만 페이지 이미지로 볼 수 있습니다.'));
    expect(await imageViewBlocks('"x"', view)).toBe('"x": PDF·이미지만 페이지 이미지로 볼 수 있습니다.');
    expect(await imageViewBlocks('"x"', vi.fn().mockRejectedValue(new FileTooLargeError(10)))).toBe('"x": 변환한 이미지가 10B 를 넘어 받지 않았습니다.');
  });
});

// 변환본이 없는 메일 첨부(WP-388)만 쓴다 — 원본을 보낼 수 있으면 그대로, 아니면 사유 안내.
describe('originalImageBlocks', () => {
  const MB = 1024 * 1024;

  it('보낼 수 있는 원본은 그대로 [설명, image] 블록으로', async () => {
    const out = (await originalImageBlocks('"a.jpg"', vi.fn().mockResolvedValue(png({ mimeType: 'image/jpeg' })))) as McpContent[];
    expect(out[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  it('형식(HEIC)·크기(상한 초과)는 사유를 안내하고 내용을 추측하지 말라고 한다', async () => {
    const heic = await originalImageBlocks('"a.heic"', vi.fn().mockResolvedValue(png({ mimeType: 'image/heic' })));
    expect(heic).toContain('형식(image/heic)');
    expect(heic).toContain('추측하지 말고');
    const big = await originalImageBlocks('"big.png"', vi.fn().mockResolvedValue(png({ data: new Uint8Array(4 * MB) })));
    expect(big).toContain(`크기(${4 * MB}B)`);
  });

  it('다운로드 상한 초과(FileTooLargeError)는 크기 사유, 다른 다운로드 오류는 삼키지 않는다', async () => {
    expect(await originalImageBlocks('"x"', vi.fn().mockRejectedValue(new FileTooLargeError()))).toContain('B 초과)');
    await expect(originalImageBlocks('"x"', vi.fn().mockRejectedValue(new Error('boom')))).rejects.toThrow('boom');
  });
});
