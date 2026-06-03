package com.workplace.contacts;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.service.ContactService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 커서 페이지 조립 및 상세 격리. 메서드 롤백 격리. */
@Transactional
class ContactServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired ContactService service;

  private long seedExternal(String name, long owner) {
    return dsl.insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, name)
        .set(CONTACT_ENTRY.OWNER_ID, owner)
        .set(CONTACT_ENTRY.VISIBILITY, "PERSONAL")
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  private long caller() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "c_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Caller " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void list_paginatesWithCursor_acrossPersonalScope() {
    long c = caller();
    // 격리된 PERSONAL 외부만 보이도록 caller 본인 소유로 3건(이름 정렬: zc0<zc1<zc2)
    String base = "zc" + UUID.randomUUID().toString().substring(0, 4);
    seedExternal(base + "_2", c);
    seedExternal(base + "_0", c);
    seedExternal(base + "_1", c);

    ContactPage p1 = service.list(c, base, "EXTERNAL", null, 2);
    assertThat(p1.items()).hasSize(2);
    assertThat(p1.hasMore()).isTrue();
    assertThat(p1.nextCursor()).isNotNull();
    assertThat(p1.items())
        .extracting(ContactSummary::name)
        .containsExactly(base + "_0", base + "_1");

    ContactPage p2 = service.list(c, base, "EXTERNAL", p1.nextCursor(), 2);
    assertThat(p2.items()).extracting(ContactSummary::name).containsExactly(base + "_2");
    assertThat(p2.hasMore()).isFalse();
    assertThat(p2.nextCursor()).isNull();
  }

  @Test
  void getMember_missing_throwsNotFound() {
    assertThatThrownBy(() -> service.getMember(99_999_999L))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  void getExternal_personalOther_throwsNotFound() {
    long owner = caller();
    long other = caller();
    long id = seedExternal("priv" + UUID.randomUUID().toString().substring(0, 4), owner);
    assertThatThrownBy(() -> service.getExternal(other, id))
        .isInstanceOf(ContactNotFoundException.class);
  }
}
