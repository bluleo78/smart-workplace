package com.workplace.project;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.workplace.support.TenantScopedIntegrationTest;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * V114 마이그레이션 후 project.type CHECK 제약이 'OPEN'을 허용하는지 검증.
 *
 * <p>@Transactional 로 테스트 후 자동 롤백되어 DB 상태를 오염시키지 않는다. TenantContext 를 @BeforeEach 에서 테넌트 1로 고정해 RLS
 * GUC(app.tenant_id)가 트랜잭션 안에서 올바르게 주입된다.
 */
@Transactional
class OpenProjectTypeMigrationTest extends TenantScopedIntegrationTest {

  @Autowired DSLContext dsl;

  /**
   * V114 이후 type='OPEN' 인 프로젝트 행 삽입이 CHECK 제약을 통과해야 한다. V114 이전에는 project_type_check 가
   * TEAM|PERSONAL만 허용하므로 이 테스트는 RED → V114 적용 후 GREEN.
   */
  @Test
  void insert_open_type_succeeds() {
    // owner_id FK 충족을 위해 테스트용 사용자 생성 (트랜잭션 롤백으로 자동 회수됨)
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long ownerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "open-test-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "OPEN테스트유저")
            .set(USER.EMAIL, "open-test-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    // OPEN 유형 프로젝트 삽입 — project_type_check CHECK 제약 통과 여부만 검증
    assertThatCode(
            () ->
                dsl.execute(
                    "INSERT INTO project (tenant_id, key, name, owner_id, type, is_default) "
                        + "VALUES (NULLIF(current_setting('app.tenant_id', true),'')::bigint, "
                        + "'OPENT', '공개접수함', "
                        + ownerId
                        + ", 'OPEN', false)"))
        .doesNotThrowAnyException();
  }
}
