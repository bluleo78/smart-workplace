package com.workplace.contacts;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** V33: USER 역할이 contact:write 를 보유하는지 검증. */
class ContactWriteGrantMigrationTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;

  @Test
  void userRole_hasContactWrite() {
    Integer count =
        dsl.selectCount()
            .from(ROLE_PERMISSION)
            .join(ROLE)
            .on(ROLE.ID.eq(ROLE_PERMISSION.ROLE_ID))
            .join(PERMISSION)
            .on(PERMISSION.ID.eq(ROLE_PERMISSION.PERMISSION_ID))
            .where(ROLE.NAME.eq("USER"))
            .and(PERMISSION.CODE.eq("contact:write"))
            .fetchOne(0, Integer.class);
    assertThat(count).isEqualTo(1);
  }
}
