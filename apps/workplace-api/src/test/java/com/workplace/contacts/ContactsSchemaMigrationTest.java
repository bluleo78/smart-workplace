package com.workplace.contacts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 연락처(contacts) 도메인 V31 스키마 마이그레이션 통합 테스트.
 *
 * <p>생성된 jOOQ 클래스에 의존하지 않도록 plain SQL 로 작성한다 — 마이그레이션이 적용되기 전에는 신규 테이블/컬럼이 없어 실패하고, V31 적용 후
 * 통과한다(TDD red→green).
 *
 * <p>공유 test DB 오염을 막기 위해 {@link Transactional} 로 각 메서드를 롤백한다.
 */
@Transactional
class ContactsSchemaMigrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  /** 테스트용 user 한 명을 시드하고 id 를 반환. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.fetchOne(
            "insert into \"user\"(username, password, name, email)"
                + " values(?, 'pw', ?, ?) returning id",
            "ct_" + s,
            "Ct" + s,
            "ct_" + s + "@example.com")
        .get(0, Long.class);
  }

  @Test
  void userTable_hasTitleColumn() {
    long uid = seedUser();
    dsl.execute("update \"user\" set title = ? where id = ?", "백엔드 엔지니어", uid);

    String title =
        dsl.fetchOne("select title from \"user\" where id = ?", uid).get(0, String.class);
    assertThat(title).isEqualTo("백엔드 엔지니어");
  }

  @Test
  void userGroup_supportsSharedPersonalAndTree() {
    long owner = seedUser();

    // 공유 그룹(조직도 루트): owner_id NULL, code 보유
    Long rootId =
        dsl.fetchOne(
                "insert into user_group(code, name, parent_id, owner_id, visibility, sort_order)"
                    + " values('ORG', '본사', null, null, 'SHARED', 0) returning id")
            .get(0, Long.class);
    // 공유 하위 그룹(트리)
    Long childId =
        dsl.fetchOne(
                "insert into user_group(code, name, parent_id, owner_id, visibility, sort_order)"
                    + " values('ORG-DEV', '개발팀', ?, null, 'SHARED', 0) returning id",
                rootId)
            .get(0, Long.class);
    // 개인 그룹: owner_id 설정, code 없음
    Long personalId =
        dsl.fetchOne(
                "insert into user_group(name, owner_id, visibility) values('내 거래처', ?, 'PERSONAL')"
                    + " returning id",
                owner)
            .get(0, Long.class);

    assertThat(rootId).isNotNull();
    assertThat(
            dsl.fetchOne("select parent_id from user_group where id = ?", childId)
                .get(0, Long.class))
        .isEqualTo(rootId);
    assertThat(
            dsl.fetchOne("select owner_id from user_group where id = ?", personalId)
                .get(0, Long.class))
        .isEqualTo(owner);
  }

  @Test
  void userGroup_personalRequiresOwner() {
    // PERSONAL 인데 owner_id 누락 → CHECK 위반
    assertThatThrownBy(
            () ->
                dsl.execute("insert into user_group(name, visibility) values('주인없음', 'PERSONAL')"))
        .isInstanceOf(Exception.class);
  }

  @Test
  void userGroup_rejectsInvalidVisibility() {
    assertThatThrownBy(
            () -> dsl.execute("insert into user_group(name, visibility) values('잘못', 'BOGUS')"))
        .isInstanceOf(Exception.class);
  }

  @Test
  void userGroupMember_storesPolymorphicTargets() {
    long member = seedUser();
    Long groupId =
        dsl.fetchOne("insert into user_group(name, visibility) values('팀', 'SHARED') returning id")
            .get(0, Long.class);
    Long contactId =
        dsl.fetchOne(
                "insert into contact_entry(name, owner_id, visibility) values('외부인', ?, 'SHARED')"
                    + " returning id",
                member)
            .get(0, Long.class);

    dsl.execute(
        "insert into user_group_member(group_id, target_type, target_id) values(?, 'MEMBER', ?)",
        groupId,
        member);
    dsl.execute(
        "insert into user_group_member(group_id, target_type, target_id) values(?, 'EXTERNAL', ?)",
        groupId,
        contactId);

    int count =
        dsl.fetchOne("select count(*) from user_group_member where group_id = ?", groupId)
            .get(0, Integer.class);
    assertThat(count).isEqualTo(2);

    // 복합 PK: 동일 (group, type, target) 중복은 거부
    assertThatThrownBy(
            () ->
                dsl.execute(
                    "insert into user_group_member(group_id, target_type, target_id)"
                        + " values(?, 'MEMBER', ?)",
                    groupId,
                    member))
        .isInstanceOf(Exception.class);
  }

  @Test
  void contactEntry_roundTripsAllFields() {
    long owner = seedUser();
    Long id =
        dsl.fetchOne(
                "insert into contact_entry(name, email, phone, organization, title, notes, owner_id,"
                    + " visibility) values('홍길동', 'h@ex.com', '010', '엑스코프', '대표', '메모', ?, 'PERSONAL')"
                    + " returning id",
                owner)
            .get(0, Long.class);

    var row =
        dsl.fetchOne(
            "select name, email, visibility, owner_id from contact_entry where id = ?", id);
    assertThat(row.get(0, String.class)).isEqualTo("홍길동");
    assertThat(row.get(1, String.class)).isEqualTo("h@ex.com");
    assertThat(row.get(2, String.class)).isEqualTo("PERSONAL");
    assertThat(row.get(3, Long.class)).isEqualTo(owner);
  }

  @Test
  void contactEntry_rejectsInvalidVisibility() {
    long owner = seedUser();
    assertThatThrownBy(
            () ->
                dsl.execute(
                    "insert into contact_entry(name, owner_id, visibility) values('x', ?, 'NOPE')",
                    owner))
        .isInstanceOf(Exception.class);
  }

  @Test
  void contactFavorite_compositeKey() {
    long owner = seedUser();
    long target = seedUser();
    dsl.execute(
        "insert into contact_favorite(owner_id, target_type, target_id) values(?, 'MEMBER', ?)",
        owner,
        target);

    int count =
        dsl.fetchOne(
                "select count(*) from contact_favorite where owner_id = ? and target_type = 'MEMBER'",
                owner)
            .get(0, Integer.class);
    assertThat(count).isEqualTo(1);

    assertThatThrownBy(
            () ->
                dsl.execute(
                    "insert into contact_favorite(owner_id, target_type, target_id)"
                        + " values(?, 'MEMBER', ?)",
                    owner,
                    target))
        .isInstanceOf(Exception.class);
  }

  @Test
  void permissions_seededAndGrantedToAdmin() {
    for (String code : new String[] {"contact:read", "contact:write", "user-group:manage"}) {
      int exists =
          dsl.fetchOne("select count(*) from permission where code = ?", code)
              .get(0, Integer.class);
      assertThat(exists).as("permission %s seeded", code).isEqualTo(1);

      int grantedToAdmin =
          dsl.fetchOne(
                  "select count(*) from role_permission rp"
                      + " join role r on r.id = rp.role_id"
                      + " join permission p on p.id = rp.permission_id"
                      + " where r.name = 'ADMIN' and p.code = ?",
                  code)
              .get(0, Integer.class);
      assertThat(grantedToAdmin).as("permission %s granted to ADMIN", code).isEqualTo(1);
    }
  }

  @Test
  void contactRead_grantedToUserRole() {
    // 모든 구성원이 디렉토리를 조회할 수 있도록 USER 역할에 contact:read 부여됨을 검증
    int grantedToUser =
        dsl.fetchOne(
                "select count(*) from role_permission rp"
                    + " join role r on r.id = rp.role_id"
                    + " join permission p on p.id = rp.permission_id"
                    + " where r.name = 'USER' and p.code = 'contact:read'")
            .get(0, Integer.class);
    assertThat(grantedToUser).as("contact:read granted to USER").isEqualTo(1);
  }
}
