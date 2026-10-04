import { describe, expect, it } from 'vitest';

import { filesFromPaste, isFileDrag } from './clipboardFiles';

// File 은 node 20+ 전역에 있다 — 이름만 비교하므로 내용은 비워 둔다.
const png = new File([''], 'shot.png', { type: 'image/png' });

/** DataTransfer 목 — 판정에 쓰는 files·types·getData 만 흉내 낸다. */
function transfer(files: File[], data: Record<string, string> = {}): DataTransfer {
  return {
    files,
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    getData: (type: string) => data[type] ?? '',
  } as unknown as DataTransfer;
}

describe('filesFromPaste', () => {
  it('스크린샷(파일만 있고 텍스트 없음)은 파일로 첨부한다', () => {
    expect(filesFromPaste(transfer([png]))).toEqual([png]);
  });

  it('"이미지 복사"(html + 파일, 텍스트 없음)도 파일로 첨부한다', () => {
    expect(filesFromPaste(transfer([png], { 'text/html': '<img>' }))).toEqual([png]);
  });

  it('워드·엑셀처럼 텍스트와 렌더링 이미지가 함께 오면 텍스트 붙여넣기로 둔다', () => {
    expect(filesFromPaste(transfer([png], { 'text/plain': '셀 값', 'text/html': '<table>' }))).toEqual([]);
  });

  it('URL 목록(text/uri-list)만 있어도 텍스트로 본다 — 위키·이슈 붙여넣기와 같은 기준', () => {
    expect(filesFromPaste(transfer([png], { 'text/uri-list': 'https://example.com' }))).toEqual([]);
  });

  it('파일이 없거나 데이터가 없으면 빈 배열', () => {
    expect(filesFromPaste(transfer([], { 'text/plain': '글' }))).toEqual([]);
    expect(filesFromPaste(null)).toEqual([]);
  });
});

describe('isFileDrag', () => {
  it('types 에 Files 가 있을 때만 파일 드래그로 본다', () => {
    expect(isFileDrag({ types: ['Files'] })).toBe(true);
    expect(isFileDrag({ types: ['text/plain'] })).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
});
