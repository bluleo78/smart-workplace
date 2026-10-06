import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { toast } from 'sonner';

import { homeApi } from '@/api/home';
import { useAttachmentDraft } from '@/hooks/useAttachmentDraft';
import { checkAttachmentCounts, oversizeMessage, splitOversize } from '@/lib/homeChatAttachments';
import { downscaleImageForUpload } from '@/lib/imageDownscale';
import type { HomeUploadedFile, TurnAttachment } from '@/types/home';

/** 업로드 중인 묶음 — 진행 칩(시안 1-3)에 이름을 보이고, 끝나면 묶음째 뺀다. */
type UploadingBatch = { id: number; names: string[] };

/**
 * 메인 AI 채팅 입력창의 첨부 초안(WP-234). useAttachmentDraft(드라이브 제외) 위에 이 화면만의 규칙을 얹는다.
 * - 개수 상한(메시지 10·세션 30)은 업로드 전에 동기로 막는다.
 * - 이미지 축소와 25MB 판정은 업로드 함수 안에서 한다. useAttachmentDraft 가 진행 중 업로드를 세는 구간 안이라야,
 *   축소 도중 전송이 열려 늦게 끝난 파일이 다음 메시지로 새는 일이 없다.
 * - 방금 올린 이미지의 로컬 미리보기(blob:) URL 을 들고 있다가, 전송하면 소유권을 화면 턴으로 넘긴다
 *   (새 대화 첫 메시지는 세션 id 가 없어 서버 원본을 받을 수 없다).
 * 드라이브 링크는 받지 않으므로 개인 스페이스·addDrive 는 내보내지 않는다 — 호출측은 ComposerAttachMenu 에 drive=false 를 준다.
 */
export function useHomeChatAttachments({
  sessionAttachmentCount,
  resetNonce,
}: {
  /** 현재 대화에서 이미 보낸 첨부 수(세션 30개 상한 기준). */
  sessionAttachmentCount: number;
  /** 실제 대화 전환 신호 — 증가하면 초안을 비운다. */
  resetNonce: number;
}) {
  // fileId → blob: 미리보기. 초안에서 빼면 해제, 전송이 수락되면 턴이 쓰므로 해제하지 않고 목록에서만 뺀다.
  const previews = useRef(new Map<number, string>());
  // 아직 초안에 들어오지 않은(업로드 중인) 파일 수 — 겹친 업로드로 메시지 10개를 넘기지 않게 개수 판정에 더한다.
  // 같은 틱에 연달아 들어온 묶음도 서로를 봐야 하므로 state 가 아닌 ref 로 동기 집계한다.
  const queued = useRef(0);
  // 업로드 중인 묶음들(진행 칩 표시용). 묶음 id 는 단조 증가 카운터.
  const [uploadingBatches, setUploadingBatches] = useState<UploadingBatch[]>([]);
  const batchSeq = useRef(0);
  // 대화 전환 세대 — 업로드 도중 새 대화로 옮기면, 늦게 끝난 파일이 새 대화 초안에 끼어들지 않게 버린다.
  const resetGen = useRef(0);

  const upload = async (files: File[]): Promise<{ data: HomeUploadedFile[] }> => {
    const gen = resetGen.current;
    const prepared = await Promise.all(files.map(downscaleImageForUpload));
    const { accepted, rejected } = splitOversize(prepared);
    if (rejected.length > 0) toast.error(oversizeMessage(rejected.map((f) => f.name)));
    if (accepted.length === 0) return { data: [] };
    const { data } = await homeApi.uploadAttachments(accepted);
    // 그 사이 대화가 바뀌었으면 이 업로드는 이전 대화의 초안이다 — 초안에 넣지 않는다(서버 임시 파일은 만료로 정리된다).
    if (gen !== resetGen.current) return { data: [] };
    // 서버는 요청 순서대로 응답한다 — 같은 자리의 파일로 미리보기를 만든다(이미지만).
    data.forEach((u, i) => {
      const f = accepted[i];
      if (f && u.mimeType.startsWith('image/')) previews.current.set(u.fileId, URL.createObjectURL(f));
    });
    return { data };
  };
  const draft = useAttachmentDraft(upload, { drive: false });

  /** ＋·붙여넣기·드롭 공용 진입점 — 개수 상한을 먼저 보고 넘으면 묶음 전체를 올리지 않는다. */
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const check = checkAttachmentCounts(files.length, draft.pending.length + queued.current, sessionAttachmentCount);
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    const batch: UploadingBatch = { id: ++batchSeq.current, names: files.map((f) => f.name) };
    queued.current += files.length;
    setUploadingBatches((prev) => [...prev, batch]);
    try {
      await draft.onFiles(files);
    } finally {
      queued.current -= files.length;
      setUploadingBatches((prev) => prev.filter((b) => b.id !== batch.id));
    }
  };

  const revoke = (fileId: number) => {
    const url = previews.current.get(fileId);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(fileId);
  };

  /** 칩 × — 미리보기까지 해제한다. */
  const removeFile = (fileId: number) => {
    revoke(fileId);
    draft.removeFile(fileId);
  };

  /** 전송용 스냅숏 — 화면 턴 첨부(이미지는 로컬 미리보기 포함). */
  const snapshot = (): TurnAttachment[] =>
    draft.pending.map((p) => ({ ...p, previewUrl: previews.current.get(p.fileId) }));

  /** 전송이 수락되면 보낸 파일만 초안에서 뺀다 — 그 사이 새로 붙인 파일은 남기고, 미리보기는 턴이 쓰므로 해제하지 않는다. */
  const commitSent = (fileIds: number[]) => {
    for (const id of fileIds) {
      previews.current.delete(id);
      draft.removeFile(id);
    }
  };

  /** 대화 전환 — 초안과 미리보기를 모두 비운다. */
  const clear = () => {
    resetGen.current += 1;
    for (const url of previews.current.values()) URL.revokeObjectURL(url);
    previews.current.clear();
    draft.reset();
  };

  const onReset = useEffectEvent(clear);
  useEffect(() => {
    if (resetNonce > 0) onReset();
  }, [resetNonce]);

  // 언마운트(시트 닫힘·모드 전환) — 보내지 않은 미리보기만 해제한다(보낸 것은 이미 목록에서 빠져 턴이 소유).
  useEffect(() => {
    const map = previews.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, []);

  return {
    pending: draft.pending,
    uploading: draft.uploading,
    /** 업로드 중인 파일 이름(진행 칩) — 축소·전송이 끝나면 초안 칩으로 바뀐다. */
    uploadingNames: uploadingBatches.flatMap((b) => b.names),
    hasAny: draft.pending.length > 0,
    addFiles,
    removeFile,
    snapshot,
    commitSent,
  };
}
