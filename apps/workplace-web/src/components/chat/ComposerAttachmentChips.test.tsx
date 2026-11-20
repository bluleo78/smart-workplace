// ComposerAttachmentChips — × 단추의 접근 이름이 칩마다 파일명을 담는지(WP-1865)와
// 긴 파일명에서도 확장자(꼬리)가 보이는지(WP-1858) 검증.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ComposerAttachmentChips } from './ComposerAttachmentChips';

const file = (fileId: number, originalName: string) => ({
  fileId,
  originalName,
  mimeType: 'application/octet-stream',
  sizeBytes: 1,
});

describe('ComposerAttachmentChips 접근 이름', () => {
  it('앞부분이 같은 긴 이름 두 칩의 × 단추는 각 파일명을 담은 서로 다른 이름이다', async () => {
    const user = userEvent.setup();
    const onRemoveFile = vi.fn();
    const a = '2026년_11월_분기_보고서_최종본_수정_A.pdf';
    const b = '2026년_11월_분기_보고서_최종본_수정_B.pdf';
    render(<ComposerAttachmentChips testIdPrefix="t" pending={[file(1, a), file(2, b)]} onRemoveFile={onRemoveFile} />);

    await user.click(screen.getByRole('button', { name: `${a} 첨부 제거` }));
    expect(onRemoveFile).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('button', { name: `${b} 첨부 제거` }));
    expect(onRemoveFile).toHaveBeenLastCalledWith(2);
  });

  it('같은 이름 두 파일도 각 단추가 자기 fileId 로 뺀다', async () => {
    const user = userEvent.setup();
    const onRemoveFile = vi.fn();
    render(<ComposerAttachmentChips testIdPrefix="t" pending={[file(1, 'a.png'), file(2, 'a.png')]} onRemoveFile={onRemoveFile} />);

    const buttons = screen.getAllByRole('button', { name: 'a.png 첨부 제거' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    expect(onRemoveFile).toHaveBeenCalledWith(2);
  });

  it('드라이브 칩 × 는 「<이름> 드라이브 링크 제거」이고 driveFileId 를 넘긴다', async () => {
    const user = userEvent.setup();
    const onRemoveDrive = vi.fn();
    render(
      <ComposerAttachmentChips
        testIdPrefix="t"
        pending={[]}
        pendingDrive={[{ driveFileId: 7, name: '설계.docx' }]}
        onRemoveFile={vi.fn()}
        onRemoveDrive={onRemoveDrive}
      />,
    );

    await user.click(screen.getByRole('button', { name: '설계.docx 드라이브 링크 제거' }));
    expect(onRemoveDrive).toHaveBeenCalledWith(7);
  });
});

describe('ComposerAttachmentChips — 긴 파일명 확장자 유지 (WP-1858)', () => {
  it('업로드 칩: 확장자를 꼬리로 따로 그리고 title 은 전체 이름', () => {
    const base = '최종_수정_필요_안_테스트_리포트_2026년_11월_분기_합본';
    render(
      <ComposerAttachmentChips
        testIdPrefix="composer"
        pending={[
          { fileId: 1, originalName: `${base}.txt`, mimeType: 'text/plain', sizeBytes: 1 },
          { fileId: 2, originalName: `${base}.xlsx`, mimeType: 'text/plain', sizeBytes: 1 },
        ]}
        onRemoveFile={vi.fn()}
      />,
    );
    const names = screen.getAllByTestId('attachment-chip-name');
    const tails = screen.getAllByTestId('attachment-chip-name-tail');
    expect(tails.map((t) => t.textContent)).toEqual(['합본.txt', '합본.xlsx']);
    expect(names.map((n) => n.getAttribute('title'))).toEqual([`${base}.txt`, `${base}.xlsx`]);
    expect(names.map((n) => n.textContent)).toEqual([`${base}.txt`, `${base}.xlsx`]);
  });

  it('드라이브 칩·업로드 중 칩도 같은 규칙', () => {
    render(
      <ComposerAttachmentChips
        testIdPrefix="composer"
        pending={[]}
        pendingDrive={[{ driveFileId: 7, name: '긴_드라이브_문서_이름_분기_보고서_최종.docx' }]}
        uploadingNames={['긴_업로드_중_파일_이름_분기_보고서.pdf']}
        onRemoveFile={vi.fn()}
        onRemoveDrive={vi.fn()}
      />,
    );
    const drive = screen.getByTestId('composer-drive-chip-7');
    expect(within(drive).getByTestId('attachment-chip-name-tail').textContent).toBe('최종.docx');
    const up = screen.getByTestId('composer-uploading-chip');
    expect(within(up).getByTestId('attachment-chip-name-tail').textContent).toBe('고서.pdf');
    expect(within(up).getByText('업로드 중')).toHaveClass('sr-only');
  });

  it('짧은 이름·확장자 없는 이름·공백 자리', () => {
    const names = ['a.txt', 'README', '보고서 최종 .pdf'];
    render(
      <ComposerAttachmentChips
        testIdPrefix="composer"
        pending={names.map((n, i) => ({ fileId: i + 1, originalName: n, mimeType: 'text/plain', sizeBytes: 1 }))}
        onRemoveFile={vi.fn()}
      />,
    );
    const els = screen.getAllByTestId('attachment-chip-name');
    expect(els.map((e) => e.textContent)).toEqual(names);
    expect(screen.getAllByTestId('attachment-chip-name-tail')[1].textContent).toBe('ME');
  });
});
