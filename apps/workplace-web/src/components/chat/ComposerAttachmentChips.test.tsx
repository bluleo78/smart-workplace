// ComposerAttachmentChips — × 단추의 접근 이름이 칩마다 파일명을 담는지 검증(WP-1865).
import { render, screen } from '@testing-library/react';
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
