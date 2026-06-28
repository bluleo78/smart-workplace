package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** file_extraction 이 테넌트 간 RLS 로 격리되는지(누수 0) 검증. 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 테스트 DB 무오염. */
class FileExtractionRlsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;

  @Test
  void fileExtraction_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) 생성 — 같은 트랜잭션 내 FK 대상
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.NAME, "rls-fx-" + suffix)
                      .set(TENANT.SLUG, "rls-fx-" + suffix)
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // USER 는 RLS 비대상 — 롤백으로 정리됨
              Long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-fx-u-" + suffix)
                      .set(USER.NAME, "RLS FX User")
                      .set(USER.EMAIL, "rls-fx-u-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // 테넌트2 컨텍스트에서 file + file_extraction 생성
              setGuc(tid2);
              Long fileId =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, "t.txt")
                      .set(FILE.STORED_NAME, "t.txt")
                      .set(FILE.MIME_TYPE, "text/plain")
                      .set(FILE.SIZE_BYTES, 1L)
                      .set(FILE.STORAGE_PATH, "x/t-" + suffix + ".txt")
                      .set(FILE.UPLOADED_BY, userId)
                      // tenant_id 는 GUC DEFAULT 로 채워짐 (명시 생략 — RLS WITH CHECK 통과)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();

              dsl.insertInto(FILE_EXTRACTION)
                  .set(FILE_EXTRACTION.FILE_ID, fileId)
                  .set(FILE_EXTRACTION.STATUS, "PENDING")
                  .set(FILE_EXTRACTION.TENANT_ID, tid2)
                  .execute();

              // tid2 컨텍스트: 삽입한 행이 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(FILE_EXTRACTION)
                              .where(FILE_EXTRACTION.FILE_ID.eq(fileId))))
                  .isEqualTo(1);

              // 테넌트1 컨텍스트: 테넌트2 행은 RLS 로 가려짐(누수 0)
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(FILE_EXTRACTION)
                              .where(FILE_EXTRACTION.FILE_ID.eq(fileId))))
                  .isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }

  /** GUC app.tenant_id 를 지정 테넌트로 설정 (트랜잭션-로컬) */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
