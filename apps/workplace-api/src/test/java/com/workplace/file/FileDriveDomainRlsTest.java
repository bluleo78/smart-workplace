package com.workplace.file;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V53 file·drive 도메인 RLS 격리 증명 — 한 테넌트의 file/drive_space/drive_space_member/drive_folder/drive_file
 * 행은 다른 테넌트 GUC 컨텍스트에서 비가시이며, 교차 UPDATE/DELETE 도 차단(0행)된다.
 *
 * <p>전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염(app_tenant 는 tenant 행 DELETE 불가 V46; 롤백으로 미커밋 tenant/도메인 행
 * 모두 사라짐). tenant_id 는 명시 set 하지 않고 컬럼 DEFAULT(현재 GUC)가 채운다 — 따라서 generated jOOQ 에 TENANT_ID 필드가
 * 없어도 컴파일된다.
 */
class FileDriveDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void fileAndDriveRows_areIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상(미커밋)으로 사용.
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-fd-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-FD")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // FK 대상 user (USER 는 RLS 비대상 — 롤백으로 정리).
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-fd-user-" + suffix)
                      .set(USER.NAME, "RLS-FD User")
                      .set(USER.EMAIL, "rls-fd-user-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // GUC 를 tid2 로 전환 후 5개 테이블 행 삽입(tenant_id 는 DEFAULT 가 tid2 로 채움 → WITH CHECK 통과).
              setGuc(tid2);

              Long fileId =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, "rls.txt")
                      .set(FILE.STORED_NAME, "rls.txt")
                      .set(FILE.MIME_TYPE, "text/plain")
                      .set(FILE.SIZE_BYTES, 3L)
                      .set(FILE.STORAGE_PATH, "/tmp/rls-" + suffix + ".txt")
                      .set(FILE.UPLOADED_BY, userId)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();

              Long spaceId =
                  dsl.insertInto(DRIVE_SPACE)
                      .set(DRIVE_SPACE.TYPE, "TEAM")
                      .set(DRIVE_SPACE.NAME, "RLS Space")
                      .set(DRIVE_SPACE.OWNER_ID, userId)
                      .returning(DRIVE_SPACE.ID)
                      .fetchOne()
                      .getId();

              dsl.insertInto(DRIVE_SPACE_MEMBER)
                  .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                  .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
                  .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
                  .execute();

              Long folderId =
                  dsl.insertInto(DRIVE_FOLDER)
                      .set(DRIVE_FOLDER.SPACE_ID, spaceId)
                      .set(DRIVE_FOLDER.NAME, "RLS Folder")
                      .returning(DRIVE_FOLDER.ID)
                      .fetchOne()
                      .getId();

              Long driveFileId =
                  dsl.insertInto(DRIVE_FILE)
                      .set(DRIVE_FILE.SPACE_ID, spaceId)
                      .set(DRIVE_FILE.FOLDER_ID, folderId)
                      .set(DRIVE_FILE.FILE_ID, fileId)
                      .set(DRIVE_FILE.NAME, "rls.txt")
                      .returning(DRIVE_FILE.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 모두 가시.
              assertThat(dsl.fetchCount(dsl.selectFrom(FILE).where(FILE.ID.eq(fileId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(DRIVE_SPACE_MEMBER)
                              .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.ID.eq(folderId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId))))
                  .isEqualTo(1);

              // GUC 를 tenant#1 로 전환 → tid2 의 행들은 모두 비가시(RLS USING 차단).
              setGuc(1L);
              assertThat(dsl.fetchCount(dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)))).isZero();
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(DRIVE_SPACE_MEMBER)
                              .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.ID.eq(folderId))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId))))
                  .isZero();

              // tenant#1 컨텍스트에서 tid2 행을 UPDATE/DELETE 시도 → USING 차단으로 0행 영향.
              assertThat(
                      dsl.update(FILE)
                          .set(FILE.ORIGINAL_NAME, "hacked")
                          .where(FILE.ID.eq(fileId))
                          .execute())
                  .isZero();
              assertThat(dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute())
                  .isZero();
              assertThat(dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute())
                  .isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }
}
