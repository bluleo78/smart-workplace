// 메일 작성창 첨부 규칙(WP-574) — 합계·한도·보내기 잠금·발송 id·전달 첨부 변환·버림 확인 판정.
import { describe, expect, it } from 'vitest';

import type { EmailAttachmentMeta } from '@/types/mailMessage';

import {
  attachmentsChanged,
  attachmentTotals,
  COMPOSE_ATTACHMENT_TOTAL_MAX,
  type ComposeAttachment,
  exceedsTotalLimit,
  failedCount,
  forwardAttachments,
  OVER_LIMIT_MESSAGE,
  quoteInlineBytes,
  retryExceedsTotalLimit,
  sendAttachmentIds,
  sendBlock,
} from './mailComposeAttachments';

const MB = 1024 * 1024;

/** 기본은 올라간 업로드 칩. */
function chip(over: Partial<ComposeAttachment> = {}): ComposeAttachment {
  return {
    key: 'k1',
    name: 'a.pdf',
    size: MB,
    mimeType: 'application/pdf',
    status: 'done',
    progress: 100,
    source: 'upload',
    id: 1,
    ...over,
  };
}

function meta(over: Partial<EmailAttachmentMeta> = {}): EmailAttachmentMeta {
  return { id: 7, filename: '안건.pdf', contentType: 'application/pdf', sizeBytes: 2048, contentId: null, ...over };
}

describe('attachmentTotals', () => {
  it('실패 칩은 빼고, 올리는 중은 넣어 개수·바이트를 센다', () => {
    const items = [
      chip({ key: 'a', size: 2 * MB }),
      chip({ key: 'b', size: 3 * MB, status: 'uploading', progress: 40, id: undefined }),
      chip({ key: 'c', size: 30 * MB, status: 'error', error: OVER_LIMIT_MESSAGE, id: undefined }),
    ];
    expect(attachmentTotals(items)).toEqual({ count: 2, bytes: 5 * MB, reservedBytes: 0 });
  });

  it('빈 목록은 0개 0바이트', () => {
    expect(attachmentTotals([])).toEqual({ count: 0, bytes: 0, reservedBytes: 0 });
  });
});

describe('exceedsTotalLimit', () => {
  it('합계가 상한과 같으면 통과, 1바이트라도 넘으면 초과다', () => {
    const items = [chip({ size: COMPOSE_ATTACHMENT_TOTAL_MAX - MB })];
    expect(exceedsTotalLimit(items, MB)).toBe(false);
    expect(exceedsTotalLimit(items, MB + 1)).toBe(true);
  });

  it('실패 칩 크기는 합계에 들지 않아 다른 파일을 막지 않는다', () => {
    const items = [chip({ size: 26 * MB, status: 'error' })];
    expect(exceedsTotalLimit(items, MB)).toBe(false);
  });
});

describe('인용문 본문 이미지(reservedBytes)', () => {
  const quote = {
    inlineImages: [
      { contentId: 'a.png', attachment: meta({ id: 11, filename: 'a.png', contentType: 'image/png', sizeBytes: 2 * MB }) },
      { contentId: 'b.png', attachment: meta({ id: 12, filename: 'b.png', contentType: 'image/png', sizeBytes: MB }) },
    ],
  };

  it('인용문 본문 이미지 크기를 모두 더하고, 인용문이 없으면 0 이다', () => {
    expect(quoteInlineBytes(quote)).toBe(3 * MB);
    expect(quoteInlineBytes(null)).toBe(0);
    expect(quoteInlineBytes({ inlineImages: [] })).toBe(0);
  });

  it('합계·한도·다시 시도·보내기 잠금이 칩에 없는 본문 이미지 크기까지 센다', () => {
    const items = [chip({ key: 'a', size: 20 * MB })];
    // 칩만 보면 20MB 라 2MB 를 더 붙일 수 있지만, 본문 이미지 3MB 가 함께 나가 25MB 를 넘는다(서버와 같은 합).
    expect(attachmentTotals(items, 3 * MB)).toEqual({ count: 1, bytes: 23 * MB, reservedBytes: 3 * MB });
    expect(exceedsTotalLimit(items, 2 * MB)).toBe(false);
    expect(exceedsTotalLimit(items, 2 * MB + 1, 3 * MB)).toBe(true);
    const withFailed = [...items, chip({ key: 'f', size: 3 * MB, status: 'error', retryable: true })];
    expect(retryExceedsTotalLimit(withFailed, 'f')).toBe(false);
    expect(retryExceedsTotalLimit(withFailed, 'f', 3 * MB)).toBe(true);
    // 전달로 연 순간 원본 첨부 + 본문 이미지가 이미 넘으면 보내기를 잠근다.
    expect(sendBlock([chip({ size: 24 * MB, source: 'forward' })], 2 * MB)).toEqual({
      reason: expect.stringContaining('25MB를 넘어요'),
      tone: 'error',
    });
    expect(sendBlock([chip({ size: 24 * MB, source: 'forward' })])).toBeNull();
  });
});

describe('retryExceedsTotalLimit', () => {
  it('실패한 동안 다른 파일이 붙어 여유가 줄었으면 다시 시도가 한도를 넘는다', () => {
    const items = [
      chip({ key: 'failed', size: 10 * MB, status: 'error', retryable: true, id: undefined }),
      chip({ key: 'later', size: 20 * MB }),
    ];
    // 실패 칩은 합계에서 빠져 있어 새 파일(20MB)이 들어왔지만, 다시 올리면 30MB 가 된다.
    expect(retryExceedsTotalLimit(items, 'failed')).toBe(true);
  });

  it('자기 크기를 더해도 상한 안이면 다시 시도할 수 있다(자기 자신은 두 번 세지 않는다)', () => {
    const items = [chip({ key: 'failed', size: 10 * MB, status: 'error' }), chip({ key: 'ok', size: 15 * MB })];
    expect(retryExceedsTotalLimit(items, 'failed')).toBe(false);
    expect(retryExceedsTotalLimit(items, 'missing')).toBe(false);
  });
});

describe('sendBlock', () => {
  it('모두 올라갔으면 잠그지 않는다', () => {
    expect(sendBlock([chip(), chip({ key: 'f', source: 'forward', id: 9 })])).toBeNull();
    expect(sendBlock([])).toBeNull();
  });

  it('올리는 중만 있으면 기다리라고(pending 톤) 알린다', () => {
    expect(sendBlock([chip({ status: 'uploading' })])).toEqual({ reason: expect.stringContaining('올리는 중'), tone: 'pending' });
  });

  it('실패 칩이 섞이면 올리는 중보다 실패를 먼저 고른다 — 문구와 색(error)이 같은 이유를 가리킨다', () => {
    const block = sendBlock([chip({ status: 'uploading' }), chip({ key: 'e', status: 'error' })]);
    expect(block).toEqual({ reason: expect.stringContaining('빼거나 다시 시도'), tone: 'error' });
  });

  it('합계 초과도 올리는 중보다 먼저(error 톤)', () => {
    const block = sendBlock([chip({ status: 'uploading', size: MB }), chip({ key: 'f', source: 'forward', size: 25 * MB })]);
    expect(block?.tone).toBe('error');
    expect(block?.reason).toContain('25MB를 넘어요');
  });
});

describe('failedCount', () => {
  it('실패 칩만 센다', () => {
    expect(failedCount([chip(), chip({ key: 'e1', status: 'error' }), chip({ key: 'e2', status: 'error' }), chip({ key: 'u', status: 'uploading' })])).toBe(2);
  });
});

describe('sendAttachmentIds', () => {
  it('올린 파일은 attachmentIds, 전달 원본은 forwardAttachmentIds 로 나눈다', () => {
    const items = [
      chip({ key: 'u1', id: 101 }),
      chip({ key: 'f1', source: 'forward', id: 31 }),
      chip({ key: 'u2', id: 102 }),
      chip({ key: 'f2', source: 'forward', id: 32 }),
    ];
    expect(sendAttachmentIds(items)).toEqual({ attachmentIds: [101, 102], forwardAttachmentIds: [31, 32] });
  });

  it('완료되지 않았거나 id 가 없는 칩은 싣지 않는다', () => {
    const items = [
      chip({ key: 'u1', status: 'uploading', id: undefined }),
      chip({ key: 'u2', status: 'error', id: undefined }),
      chip({ key: 'u3', id: 103 }),
    ];
    expect(sendAttachmentIds(items)).toEqual({ attachmentIds: [103], forwardAttachmentIds: [] });
  });
});

describe('forwardAttachments', () => {
  it('원본 첨부를 올라간 전달 칩으로 바꾼다', () => {
    expect(forwardAttachments([meta()])).toEqual([
      {
        key: 'forward-7',
        name: '안건.pdf',
        size: 2048,
        mimeType: 'application/pdf',
        status: 'done',
        progress: 100,
        source: 'forward',
        id: 7,
      },
    ]);
  });

  it('인용문이 cid 로 다시 붙이는 본문 이미지는 뺀다', () => {
    const list = forwardAttachments([meta({ id: 1 }), meta({ id: 2, filename: 'logo.png', contentType: 'image/png' })], new Set([2]));
    expect(list.map((a) => a.id)).toEqual([1]);
  });

  it('이름이 없으면 attachment-{id}, 범용 형식이면 확장자로 형식을 추론한다', () => {
    const [a] = forwardAttachments([meta({ id: 5, filename: null, contentType: null })]);
    expect(a.name).toBe('attachment-5');
    const [b] = forwardAttachments([meta({ filename: '표.xlsx', contentType: 'application/octet-stream' })]);
    expect(b.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
});

describe('attachmentsChanged', () => {
  const initial = [chip({ key: 'forward-1', source: 'forward', id: 1 }), chip({ key: 'forward-2', source: 'forward', id: 2 })];

  it('전달 원본이 처음 그대로면 바뀌지 않은 것이다', () => {
    expect(attachmentsChanged(initial, initial)).toBe(false);
    expect(attachmentsChanged([], [])).toBe(false);
  });

  it('전달 원본을 하나라도 빼면 바뀐 것이다', () => {
    expect(attachmentsChanged([initial[0]], initial)).toBe(true);
  });

  it('올린 파일이 있으면(실패 칩이라도) 바뀐 것이다', () => {
    expect(attachmentsChanged([chip({ status: 'error' })], [])).toBe(true);
  });
});
