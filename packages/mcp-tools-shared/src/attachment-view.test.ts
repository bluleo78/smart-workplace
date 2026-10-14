import { describe, expect, it, vi } from 'vitest';

import { FileTooLargeError } from './attachment-read.js';
import { IMAGE_BUDGET_EXHAUSTED, IMAGE_BUDGET_PER_RUN, ImageBudget, imageBlocksFor, pageBlocks, pagesShape, viewBlocks } from './attachment-view.js';
import type { McpContent } from './mcp-content.js';
import type { FileBytes } from './tool-client.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const png = (over: Partial<FileBytes> = {}): FileBytes => ({ data: PNG, mimeType: 'image/png', ...over });

describe('ImageBudget', () => {
  it('남은 장수 안에서만 차감하고, 넘치면 차감하지 않고 false', () => {
    const b = new ImageBudget(2);
    expect(b.take(1)).toBe(true);
    expect(b.take(2)).toBe(false);
    expect(b.take(1)).toBe(true);
    expect(b.take(1)).toBe(false);
  });

  it('refund 는 상한(cap)을 넘겨 늘리지 않는다', () => {
    const b = new ImageBudget(2);
    b.take(1);
    b.refund(5);
    expect(b.take(2)).toBe(true);
    expect(b.take(1)).toBe(false);
  });

  // 리뷰 M3: 남은 장수가 있으면 몇 장 남았는지, 없으면 실제 상한으로 다 썼다고 말한다.
  it('shortfall 안내 — 남았으면 남은 장수·요청 장수, 다 썼으면 실제 상한', () => {
    const b = new ImageBudget(20);
    b.take(18);
    expect(b.shortfall(3)).toBe('이번 대화에서 볼 수 있는 이미지가 2장 남았습니다(요청 3장). 2장 이하로 줄여 다시 요청하세요.');
    b.take(2);
    expect(b.shortfall(1)).toBe(IMAGE_BUDGET_EXHAUSTED);
    const small = new ImageBudget(5);
    small.take(5);
    expect(small.shortfall(1)).toContain('다 썼습니다(5장)');
    expect(IMAGE_BUDGET_EXHAUSTED).toContain(`(${IMAGE_BUDGET_PER_RUN}장)`);
  });
});

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

  it('서버가 알려 준 전체 쪽수(X-Page-Count)를 설명에 붙인다', async () => {
    const out = (await pageBlocks('"보고서.pdf"', [2], async () => png({ pageCount: 6 }))) as McpContent[];
    expect(out[0]).toEqual({ type: 'text', text: '"보고서.pdf" 2쪽(전체 6쪽) (image/png, 4B)' });
  });

  it('예산이 모자라면 받지 않고 남은 장수 안내만', async () => {
    const fetch = vi.fn();
    expect(await pageBlocks('"보고서.pdf"', [1, 2], fetch, new ImageBudget(1))).toContain('1장 남았습니다(요청 2장)');
    expect(fetch).not.toHaveBeenCalled();
  });

  // 리뷰 M2: 예산은 모델에 실제로 준 이미지 장수만 센다 — 실패한 쪽(범위 밖·손상)은 되돌린다.
  it('실패한 쪽은 예산을 되돌린다', async () => {
    const budget = new ImageBudget(3);
    await pageBlocks('"a.pdf"', [6, 7], async (n) => {
      if (n === 7) throw new Error('이 PDF 는 6쪽입니다.');
      return png();
    }, budget);
    expect(budget.take(2)).toBe(true);
    expect(budget.take(1)).toBe(false);
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

  it('예산은 중복을 뺀 장수만큼 먼저 차감한다', async () => {
    const budget = new ImageBudget(2);
    await pageBlocks('"a.pdf"', [1, 1, 2], async () => png(), budget);
    expect(budget.take(1)).toBe(false);
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

describe('imageBlocksFor', () => {
  const MB = 1024 * 1024;

  it('보낼 수 있는 jpeg(1MB): 원본을 받고 변환본은 부르지 않는다', async () => {
    const download = vi.fn().mockResolvedValue(png({ mimeType: 'image/jpeg' }));
    const view = vi.fn();
    const out = (await imageBlocksFor('"a.jpg"', { mimeType: 'image/jpeg', sizeBytes: MB }, download, view)) as McpContent[];
    expect(download).toHaveBeenCalled();
    expect(view).not.toHaveBeenCalled();
    expect(out[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  it('HEIC 메타: 원본을 받지 않고 변환본', async () => {
    const download = vi.fn();
    const view = vi.fn().mockResolvedValue(png({ mimeType: 'image/jpeg' }));
    const out = (await imageBlocksFor('"a.heic"', { mimeType: 'image/heic', sizeBytes: 10 }, download, view)) as McpContent[];
    expect(download).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalled();
    expect(out[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  it('png 5MB 메타: 원본을 받지 않고 변환본', async () => {
    const download = vi.fn();
    const view = vi.fn().mockResolvedValue(png());
    await imageBlocksFor('"big.png"', { mimeType: 'image/png', sizeBytes: 5 * MB }, download, view);
    expect(download).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalled();
  });

  it('크기를 모르고 다운로드가 상한을 넘으면(FileTooLargeError) 변환본', async () => {
    const download = vi.fn().mockRejectedValue(new FileTooLargeError());
    const view = vi.fn().mockResolvedValue(png());
    const out = (await imageBlocksFor('"x"', {}, download, view)) as McpContent[];
    expect(view).toHaveBeenCalled();
    expect(out[1]).toMatchObject({ type: 'image' });
  });

  it('메타가 없어 받은 원본이 보낼 수 없는 형식이면(HEIC) 변환본', async () => {
    const download = vi.fn().mockResolvedValue(png({ mimeType: 'image/heic' }));
    const view = vi.fn().mockResolvedValue(png({ mimeType: 'image/jpeg' }));
    const out = (await imageBlocksFor('"x"', {}, download, view)) as McpContent[];
    expect(view).toHaveBeenCalled();
    expect(out[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  it('변환 실패(서버 4xx·5xx)는 메시지를 text 로, 다른 다운로드 오류는 삼키지 않는다', async () => {
    const view = vi.fn().mockRejectedValue(new Error('PDF·이미지만 페이지 이미지로 볼 수 있습니다.'));
    expect(await imageBlocksFor('"x"', { mimeType: 'image/heic' }, vi.fn(), view)).toContain('PDF·이미지만 페이지 이미지로 볼 수 있습니다.');
    await expect(imageBlocksFor('"x"', {}, vi.fn().mockRejectedValue(new Error('boom')), vi.fn())).rejects.toThrow('boom');
  });

  it('예산을 1장 차감하고, 다 썼으면 받지 않는다', async () => {
    const budget = new ImageBudget(1);
    const download = vi.fn().mockResolvedValue(png());
    await imageBlocksFor('"a.png"', {}, download, vi.fn(), budget);
    expect(await imageBlocksFor('"b.png"', {}, download, vi.fn(), budget)).toContain('다 썼습니다(1장)');
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('이미지를 주지 못하면(변환 실패 안내·다운로드 오류) 예산을 되돌린다', async () => {
    const budget = new ImageBudget(1);
    await imageBlocksFor('"x"', { mimeType: 'image/heic' }, vi.fn(), vi.fn().mockRejectedValue(new Error('415')), budget);
    await expect(imageBlocksFor('"x"', {}, vi.fn().mockRejectedValue(new Error('boom')), vi.fn(), budget)).rejects.toThrow('boom');
    expect(budget.take(1)).toBe(true);
  });
});
