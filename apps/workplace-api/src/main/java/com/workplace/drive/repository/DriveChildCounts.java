package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;

import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;

/**
 * 목록 행에 붙이는 「폴더 바로 아래 살아 있는(휴지통 아님) 폴더·파일 수」 스칼라 서브쿼리. 「별표」({@link DriveStarRepository})와 「공유받은
 * 항목」({@link DriveShareLinkVisitRepository})이 같은 기준으로 세도록 한 곳에 둔다 — 서브트리 전체가 아니라 바로 아래만 센다(큰 트리에서
 * 비싸다). 단건 조회용 {@link DriveSharedFolderRepository#countChildren} 과 같은 규칙이다.
 */
final class DriveChildCounts {
  /** 하위 폴더를 세는 서브쿼리용 별칭 — 바깥 질의의 drive_folder 와 섞이지 않게 따로 이름 붙인다. */
  private static final com.workplace.jooq.tables.DriveFolder CHILD_FOLDER =
      DRIVE_FOLDER.as("child_count_folder");

  /** 하위 파일을 세는 서브쿼리용 별칭. */
  private static final com.workplace.jooq.tables.DriveFile CHILD_FILE =
      DRIVE_FILE.as("child_count_file");

  private DriveChildCounts() {}

  /**
   * 바깥 행의 폴더(parentFolderId) 바로 아래 살아 있는 폴더 수 — guard 가 참인 행만 세고 그 밖은 null.
   *
   * @param guard 셀 행 조건(예: 폴더 행이고 열 수 있음)
   * @param parentFolderId 바깥 질의에서 셀 폴더 id 를 가리키는 칸
   */
  static Field<Integer> liveFolders(Condition guard, Field<Long> parentFolderId) {
    return DSL.when(
        guard,
        DSL.field(
            DSL.selectCount()
                .from(CHILD_FOLDER)
                .where(CHILD_FOLDER.PARENT_ID.eq(parentFolderId))
                .and(CHILD_FOLDER.TRASHED_AT.isNull())));
  }

  /** 바깥 행의 폴더 바로 아래 살아 있는 파일 수 — {@link #liveFolders} 와 같은 규칙으로 파일을 센다. */
  static Field<Integer> liveFiles(Condition guard, Field<Long> parentFolderId) {
    return DSL.when(
        guard,
        DSL.field(
            DSL.selectCount()
                .from(CHILD_FILE)
                .where(CHILD_FILE.FOLDER_ID.eq(parentFolderId))
                .and(CHILD_FILE.TRASHED_AT.isNull())));
  }
}
