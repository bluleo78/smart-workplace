package com.workplace.tenant;

import static com.workplace.jooq.Tables.TENANT_CANARY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 통합테스트 하버스 검증: test 프로파일 커넥션의 세션 GUC 기본값(app.tenant_id=1) 덕분에 트랜잭션 밖 autocommit DSL 시드가 RLS 테이블에서도
 * 정상 INSERT·가시됨을 증명한다. 이 하버스가 도메인 RLS(V48) 이후 전체 스위트의 시드 코드를 동작하게 한다.
 */
class TestHarnessRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  @AfterEach
  void cleanup() {
    // 자기-스코프 삭제 — 공유 test DB 카나리아 오염 방지. (세션 GUC=1 이라 app_tenant 도 tenant#1 행 DELETE 가능)
    dsl.deleteFrom(TENANT_CANARY).where(TENANT_CANARY.VAL.eq("harness-probe")).execute();
  }

  @Test
  void autocommitInsert_intoRlsTable_succeedsAndVisible() {
    dsl.insertInto(TENANT_CANARY)
        .set(TENANT_CANARY.TENANT_ID, 1L)
        .set(TENANT_CANARY.VAL, "harness-probe")
        .execute();
    assertThat(
            dsl.fetchCount(
                dsl.selectFrom(TENANT_CANARY).where(TENANT_CANARY.VAL.eq("harness-probe"))))
        .isEqualTo(1);
  }
}
