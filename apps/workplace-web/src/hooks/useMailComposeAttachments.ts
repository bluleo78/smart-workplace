// 메일 작성창 첨부 상태(WP-574) — 파일을 받으면 바로 하나씩 올리고(사전 업로드), 칩마다 진행률·실패·다시 시도·빼기를 관리한다.
// 채팅의 useAttachmentDraft 는 여러 파일을 한 요청으로 올려 진행률·개별 실패가 없어 따로 둔다.

import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadComposeAttachment } from '@/api/mailMessages';
import { extractApiError, isPermanentClientStatus } from '@/lib/api-error';
import {
  attachmentsChanged,
  attachmentTotals,
  type ComposeAttachment,
  exceedsTotalLimit,
  failedCount,
  OVER_LIMIT_MESSAGE,
  retryExceedsTotalLimit,
  sendBlock,
  UPLOAD_FAILED_MESSAGE,
} from '@/lib/mailComposeAttachments';

/**
 * @param reservedBytes 칩으로 보이지 않지만 함께 나가 한도에 드는 바이트 — 인용문이 다시 붙이는 본문 이미지(quoteInlineBytes).
 *   인용문을 지우면 0 이 되어 그만큼 여유가 생긴다.
 */
export function useMailComposeAttachments(reservedBytes = 0) {
  const [items, setItems] = useState<ComposeAttachment[]>([]);
  // 최신 칩 목록 — 한도 판정(addFiles·retry)은 렌더 클로저가 아니라 이것을 본다. 리렌더 전에 연속으로 불려도(드롭 두 번 등)
  // 앞 호출이 붙인 칩까지 세어야 합계 상한을 넘지 않는다. 모든 갱신은 update 를 거쳐 ref 와 state 를 함께 바꾼다.
  const itemsRef = useRef<ComposeAttachment[]>([]);
  // 처음 채워진 첨부(전달 원본) — 버림 확인의 기준값.
  const [initial, setInitial] = useState<ComposeAttachment[]>([]);
  // 업로드 취소기. 렌더와 무관하므로 ref 에 둔다(다시 시도에 쓸 원본 파일은 칩의 file 에 있다).
  const aborts = useRef(new Map<string, AbortController>());
  const seq = useRef(0);

  /** 칩 목록 갱신 — ref 를 먼저 바꿔 같은 틱의 다음 판정이 바로 본다. 바뀐 게 없으면(같은 배열) 다시 그리지 않는다. */
  const update = useCallback((fn: (prev: ComposeAttachment[]) => ComposeAttachment[]) => {
    const next = fn(itemsRef.current);
    if (next === itemsRef.current) return;
    itemsRef.current = next;
    setItems(next);
  }, []);

  /** key 하나만 고친다(진행률·완료·실패 반영). 그사이 빠진 칩이면 아무 일도 없다. */
  const patch = useCallback(
    (key: string, next: Partial<ComposeAttachment>) => {
      update((prev) => prev.map((a) => (a.key === key ? { ...a, ...next } : a)));
    },
    [update],
  );

  /**
   * 진행률 반영 — 반올림한 %가 그대로면 건너뛴다. 진행 이벤트는 자주 오고 칩 목록이 바뀌면 작성창 전체가 다시 그려지므로,
   * 화면에 보이는 값이 바뀔 때만 갱신한다.
   */
  const setProgress = useCallback(
    (key: string, progress: number) => {
      update((prev) => {
        const cur = prev.find((a) => a.key === key);
        return !cur || cur.progress === progress ? prev : prev.map((a) => (a === cur ? { ...a, progress } : a));
      });
    },
    [update],
  );

  /** 파일 하나 올리기 — 칩은 이미 uploading 으로 들어가 있다. */
  const upload = useCallback(
    (key: string, file: File) => {
      const controller = new AbortController();
      aborts.current.set(key, controller);
      uploadComposeAttachment(file, {
        signal: controller.signal,
        onProgress: (progress) => setProgress(key, progress),
      })
        .then((res) => patch(key, { status: 'done', progress: 100, id: res.id }))
        .catch((err) => {
          // 빼기·닫기로 취소한 업로드는 칩이 이미 없으니 실패로 표시하지 않는다.
          if (axios.isCancel(err)) return;
          // 4xx(파일당 25MB 초과 등)는 다시 올려도 같으므로 서버 문구만 보이고 다시 시도를 달지 않는다.
          // 네트워크·5xx 는 일시 실패라 짧은 문구 + 다시 시도.
          const permanent = isPermanentClientStatus(axios.isAxiosError(err) ? err.response?.status : undefined);
          patch(key, {
            status: 'error',
            error: permanent ? extractApiError(err, UPLOAD_FAILED_MESSAGE) : UPLOAD_FAILED_MESSAGE,
            retryable: !permanent,
          });
        })
        .finally(() => {
          if (aborts.current.get(key) === controller) aborts.current.delete(key);
        });
    },
    [patch, setProgress],
  );

  const abortAll = useCallback(() => {
    aborts.current.forEach((c) => c.abort());
    aborts.current.clear();
  }, []);

  // 작성창이 사라지면 올리던 것도 멈춘다.
  useEffect(() => abortAll, [abortAll]);

  /** 새 작성마다 — 올리던 것을 멈추고 처음 첨부(전달 원본)로 되돌린다. */
  const reset = useCallback(
    (seed: ComposeAttachment[] = []) => {
      abortAll();
      update(() => seed);
      setInitial(seed);
    },
    [abortAll, update],
  );

  /**
   * 파일 선택·끌어다 놓기 공용 진입점. 합계 상한을 넘기는 파일은 올리지 않고 실패 칩(다시 시도 없음)으로 남겨 왜 빠졌는지 보이게 한다.
   * 한도는 앞 파일부터 차례로 채워 본다 — 한 번에 여러 개를 넣어도 들어갈 만큼은 들어간다.
   */
  const addFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list || list.length === 0) return;
      const incoming = Array.from(list);
      let running = itemsRef.current;
      const added: ComposeAttachment[] = [];
      const toUpload: [string, File][] = [];
      for (const file of incoming) {
        const key = `upload-${++seq.current}`;
        const over = exceedsTotalLimit(running, file.size, reservedBytes);
        const item: ComposeAttachment = {
          key,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          status: over ? 'error' : 'uploading',
          progress: 0,
          source: 'upload',
          // 한도 초과는 다시 시도할 수 없으니 원본 파일을 들고 있지 않는다.
          ...(over ? { error: OVER_LIMIT_MESSAGE, retryable: false } : { file }),
        };
        added.push(item);
        running = [...running, item];
        if (!over) toUpload.push([key, file]);
      }
      update((prev) => [...prev, ...added]);
      toUpload.forEach(([key, file]) => upload(key, file));
    },
    [reservedBytes, update, upload],
  );

  /** 첨부 빼기 — 올리는 중이면 취소한다. */
  const remove = useCallback(
    (key: string) => {
      aborts.current.get(key)?.abort();
      aborts.current.delete(key);
      update((prev) => prev.filter((a) => a.key !== key));
    },
    [update],
  );

  /**
   * 다시 시도 — 서버·네트워크 실패만(한도 초과는 retryable=false 라 버튼이 없다).
   * 실패한 동안 다른 파일이 붙어 합계 여유가 줄었을 수 있으니, 올리기 전에 한도를 다시 보고 넘으면 다시 시도할 수 없는 한도 초과 칩으로 바꾼다.
   */
  const retry = useCallback(
    (key: string) => {
      const file = itemsRef.current.find((a) => a.key === key)?.file;
      if (!file) return;
      if (retryExceedsTotalLimit(itemsRef.current, key, reservedBytes)) {
        patch(key, { error: OVER_LIMIT_MESSAGE, retryable: false, file: undefined });
        return;
      }
      patch(key, { status: 'uploading', progress: 0, error: undefined, retryable: undefined });
      upload(key, file);
    },
    [patch, reservedBytes, upload],
  );

  return {
    items,
    addFiles,
    remove,
    retry,
    reset,
    totals: attachmentTotals(items, reservedBytes),
    changed: attachmentsChanged(items, initial),
    /** 보내기 잠금(이유·톤, 없으면 null) — 작성창 보내기 버튼·잠금 안내가 같은 값을 쓴다. */
    block: sendBlock(items, reservedBytes),
    /** 실패 칩 수 — 합계 줄 「실패 N」. */
    failedCount: failedCount(items),
  };
}
