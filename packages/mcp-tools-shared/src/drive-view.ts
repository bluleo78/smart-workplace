// src/drive-view.ts — 드라이브 파일 행의 LLM 노출 뷰(#840). ai-agent·workplace-mcp 가 같은 규칙을 쓰도록 공유한다.
//
// API 파일 행에는 drive_file.id(id)와 core file.id(fileId)가 함께 있고 둘은 별도 시퀀스라 값이 겹친다.
// 이동·삭제는 drive_file.id 를 받으므로, 같은 이름의 fileId 가 보이면 LLM 이 그것을 넘겨 엉뚱한 파일을 건드린다.
// 그래서 core fileId 는 제거하고 drive_file.id 는 driveFileId 로만 노출한다. 나머지 필드는 그대로 넘긴다 —
// 허용 목록으로 고르면 서버에 새 필드(예: available)가 생길 때 조용히 누락된다.
import { dropEmpty } from './compact.js';

/** 드라이브 파일 행 → LLM 뷰. core fileId 를 버리고 id 를 driveFileId 로 옮긴다. */
export type DriveFileView<T extends { id: number; fileId: number }> = Omit<T, 'id' | 'fileId'> & { driveFileId: number };

/** 내용 검색 응답({hits}) → LLM 뷰. hit 은 이미 driveFileId 로 오므로 core fileId 만 지운다. */
export function toDriveContentHitsView<R extends { hits: { fileId: number }[] }>(r: R) {
  return { ...r, hits: r.hits.map(({ fileId: _coreFileId, ...hit }) => hit) };
}

/**
 * 폴더 행 → LLM 뷰. 공용 `id` 를 folderId 로 바꾼다(WP-353) — 폴더 쓰기 도구(rename·move·restore)의 입력 이름이자 휴지통 뷰
 * (toDriveTrashView)가 이미 쓰는 이름이다. 폴더 행에는 core fileId 같은 겹치는 번호가 없어 이름 바꾸기만 하면 된다.
 */
export function toDriveFolderView<F extends { id: number }>({ id, ...rest }: F): Omit<F, 'id'> & { folderId: number } {
  return { folderId: id, ...rest };
}

/** 드라이브 items/search 응답({folders, files}) → LLM 뷰. 폴더는 folderId, 파일은 driveFileId 로 가리킨다. */
export function toDriveItemsView<F extends { id: number }, T extends { id: number; fileId: number }>(r: { folders: F[]; files: T[] }) {
  return {
    folders: r.folders.map(toDriveFolderView),
    files: r.files.map(({ id, fileId: _coreFileId, ...rest }): DriveFileView<T> => ({ ...rest, driveFileId: id }) as DriveFileView<T>),
  };
}

/**
 * 휴지통 항목 → LLM 뷰(#854). 서버는 FILE·FOLDER 모두 id 하나로 주지만 둘은 다른 시퀀스다.
 * 복원 도구가 driveFileId/folderId 를 나눠 받으므로 뷰도 type 에 맞는 이름으로만 id 를 준다.
 */
export function toDriveTrashView<T extends { type: 'FILE' | 'FOLDER'; id: number }>(items: T[]) {
  return items.map(({ id, ...rest }) => (rest.type === 'FILE' ? { ...rest, driveFileId: id } : { ...rest, folderId: id }));
}

/** 파일 단건 행(rename·copy·import 응답) → LLM 뷰. 목록의 파일 행과 같은 규칙(core fileId 제거, id → driveFileId, WP-354). */
export function toDriveFileView<T extends { id: number; fileId: number }>({ id, fileId: _coreFileId, ...rest }: T): DriveFileView<T> {
  return { ...rest, driveFileId: id } as DriveFileView<T>;
}

/**
 * 파일 버전 목록(DriveFileVersionResponse[]) → LLM 뷰(WP-354). 업로더 숫자 ID(uploadedBy, #833)와 버전 blob 의 core fileId 는 버리고
 * 업로더는 이름(uploadedByName)으로만 둔다. 값이 없는 키(comment)는 생략하고 current 는 현재 버전일 때만 싣는다(키 없음 = 이전 버전).
 */
export function toDriveVersionsView(rows: { versionNo: number; sizeBytes: number; current: boolean; [key: string]: unknown }[]) {
  return rows.map(({ uploadedBy: _uploadedBy, fileId: _coreFileId, current, ...rest }) =>
    dropEmpty({ ...rest, ...(current && { current: true }) }),
  );
}

/** 파일 백링크(BacklinkResponse[]) → LLM 뷰(WP-354). sourceId 는 이슈·메시지의 내부 번호라 모델이 쓸 곳이 없어 뺀다 — label 과 deepLink 로 가리킨다. */
export function toDriveBacklinksView(rows: { sourceType: string; label: string; deepLink: string; [key: string]: unknown }[]) {
  return rows.map(({ sourceId: _sourceId, ...rest }) => rest);
}
