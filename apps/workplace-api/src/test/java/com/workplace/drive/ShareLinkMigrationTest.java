package com.workplace.drive;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V78 스키마/함수 검증: SECURITY DEFINER 함수는 GUC 컨텍스트 없이도 row 를 resolve, 테이블은 RLS 로 격리됨을 증명.
 *
 * <p>패턴: TransactionTemplate + setRollbackOnly — @Transactional 테스트는 doBegin 전에 TenantContext 를 설정할
 * 수 없으므로 GUC 전환이 불가. 여기서는 직접 set_config 로 GUC 를 제어한다.
 */
class ShareLinkMigrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;

  @Test
  void resolveFunction_returnsRow_withoutTenantContext() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 테넌트 #1 컨텍스트에서 seed 데이터 삽입
              setGuc(1L);
              long userId = seedUser();
              long spaceId = seedSpace(userId);
              long fileId = seedFile(userId, spaceId);

              // 64-char SHA-256 hex 형식 토큰 해시 생성 (UUID 2개 연결 후 64자 추출)
              String hash =
                  (UUID.randomUUID().toString().replace("-", "")
                          + UUID.randomUUID().toString().replace("-", ""))
                      .substring(0, 64);

              dsl.execute(
                  "INSERT INTO drive_share_link"
                      + " (drive_file_id, space_id, token_hash, audience, created_by)"
                      + " VALUES (?, ?, ?, 'EXTERNAL', ?)",
                  fileId,
                  spaceId,
                  hash,
                  userId);

              // GUC 를 비워서 컨텍스트 없는 상태로 → 직접 SELECT 는 RLS 로 0행 (NULLIF('','')=NULL)
              clearGuc();
              long direct =
                  (long)
                      dsl.fetchValue(
                          "SELECT COUNT(*) FROM drive_share_link WHERE token_hash = ?", hash);
              assertThat(direct).isZero();

              // SECURITY DEFINER 함수는 GUC 무관하게 resolve
              var rec =
                  dsl.resultQuery(
                          "SELECT tenant_id, drive_file_id FROM drive_share_link_resolve(?)", hash)
                      .fetchOne();
              assertThat(rec).isNotNull();
              assertThat(rec.get("drive_file_id", Long.class)).isEqualTo(fileId);
              assertThat(rec.get("tenant_id", Long.class)).isEqualTo(1L);

              status.setRollbackOnly(); // 공유 test DB 무오염
              return null;
            });
  }

  /** USER 행 삽입 (tenant_id 없는 테이블, UUID suffix 으로 고유 보장). */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return (long)
        dsl.fetchValue(
            "INSERT INTO \"user\" (username, password, name, email) VALUES (?, 'pw', ?, ?) RETURNING id",
            "sl_" + s,
            "SL" + s,
            "sl_" + s + "@example.com");
  }

  /** drive_space + OWNER 멤버 삽입 (현재 GUC 테넌트 컨텍스트 필요). */
  private long seedSpace(long ownerId) {
    long spaceId =
        (long)
            dsl.fetchValue(
                "INSERT INTO drive_space (type, name, owner_id) VALUES ('TEAM', 'sl-space', ?) RETURNING id",
                ownerId);
    dsl.execute(
        "INSERT INTO drive_space_member (space_id, user_id, role) VALUES (?, ?, 'OWNER')",
        spaceId,
        ownerId);
    return spaceId;
  }

  /** file core + drive_file 행 삽입 (현재 GUC 테넌트 컨텍스트 필요). */
  private long seedFile(long userId, long spaceId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long fileId =
        (long)
            dsl.fetchValue(
                "INSERT INTO file"
                    + " (original_name, stored_name, mime_type, size_bytes, storage_path, uploaded_by)"
                    + " VALUES ('test.txt', ?, 'text/plain', 5, ?, ?) RETURNING id",
                "stored-" + s,
                "/drive/test-" + s,
                userId);
    return (long)
        dsl.fetchValue(
            "INSERT INTO drive_file (space_id, file_id, name) VALUES (?, ?, 'test.txt') RETURNING id",
            spaceId,
            fileId);
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    // 문자열 보간 대신 바인드 파라미터 사용(프로덕션 GUC 설정 방식과 일관).
    dsl.execute("SELECT set_config('app.tenant_id', CAST(? AS TEXT), true)", tenantId);
  }

  /** GUC 를 빈 문자열로 초기화 → NULLIF('','')=NULL → RLS 정책 false → 0행. */
  private void clearGuc() {
    dsl.execute("SELECT set_config('app.tenant_id', '', true)");
  }
}
