// src/drive-view.ts — 드라이브 파일 행의 LLM 노출 뷰(#840). ai-agent·workplace-mcp 가 같은 규칙을 쓰도록 공유한다.
//
// API 파일 행에는 drive_file.id(id)와 core file.id(fileId)가 함께 있고 둘은 별도 시퀀스라 값이 겹친다.
// 이동·삭제는 drive_file.id 를 받으므로, 같은 이름의 fileId 가 보이면 LLM 이 그것을 넘겨 엉뚱한 파일을 건드린다.
// 그래서 core fileId 는 제거하고 drive_file.id 는 driveFileId 로만 노출한다. 나머지 필드는 그대로 넘긴다 —
// 허용 목록으로 고르면 서버에 새 필드(예: available)가 생길 때 조용히 누락된다.

/** 드라이브 파일 행 → LLM 뷰. core fileId 를 버리고 id 를 driveFileId 로 옮긴다. */
export type DriveFileView<T extends { id: number; fileId: number }> = Omit<T, 'id' | 'fileId'> & { driveFileId: number };

/** 내용 검색 응답({hits}) → LLM 뷰. hit 은 이미 driveFileId 로 오므로 core fileId 만 지운다. */
export function toDriveContentHitsView<R extends { hits: { fileId: number }[] }>(r: R) {
  return { ...r, hits: r.hits.map(({ fileId: _coreFileId, ...hit }) => hit) };
}

/** 드라이브 items/search 응답({folders, files}) → LLM 뷰. 폴더 행은 id 하나뿐이라 그대로 둔다. */
export function toDriveItemsView<F, T extends { id: number; fileId: number }>(r: { folders: F[]; files: T[] }) {
  return {
    folders: r.folders,
    files: r.files.map(({ id, fileId: _coreFileId, ...rest }): DriveFileView<T> => ({ ...rest, driveFileId: id }) as DriveFileView<T>),
  };
}
