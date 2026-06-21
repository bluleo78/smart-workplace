package com.workplace.contacts;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.repository.ContactCursorCodec;
import com.workplace.contacts.repository.ContactRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 통합 목록 머지/검색/타입/커서/격리 + 상세. 공유 test DB 오염 방지 위해 메서드 트랜잭션 롤백 격리. */
@Transactional
class ContactRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired ContactRepository repo;

  private String tag() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  private long seedUser(String name, String kind) {
    String t = tag();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "u_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, kind)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedExternal(String name, String visibility, long ownerId) {
    return dsl.insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, name)
        .set(CONTACT_ENTRY.EMAIL, "ext_" + tag() + "@corp.com")
        .set(CONTACT_ENTRY.ORGANIZATION, "Corp")
        .set(CONTACT_ENTRY.OWNER_ID, ownerId)
        .set(CONTACT_ENTRY.VISIBILITY, visibility)
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void list_mergesMembersAndExternals_sortedByName() {
    // 공유 test DB 에 데이터가 많아 search=null + limit 100 으로는 시드 행이 범위 밖일 수 있다.
    // 고유 prefix 로 검색해 시드한 3건만 결정적으로 매칭(이름 순서: _AA < _BB < _ZZ).
    String p = "zmrg" + tag();
    long caller = seedUser(p + "_ZZ_caller", "HUMAN");
    long m = seedUser(p + "_AA_member", "HUMAN");
    long e = seedExternal(p + "_BB_external", "SHARED", caller);

    List<ContactSummary> rows = repo.findPage(caller, p, "ALL", false, null, 100);

    assertThat(rows).extracting(ContactSummary::id).contains(m, e, caller);
    assertThat(rows).extracting(ContactSummary::type).contains("MEMBER", "EXTERNAL");
    // 멤버+외부가 단일 목록에 (name, type, id) 오름차순으로 머지됨
    assertThat(rows)
        .extracting(ContactSummary::name)
        .containsExactly(p + "_AA_member", p + "_BB_external", p + "_ZZ_caller");
  }

  @Test
  void list_excludesAgentMembers() {
    long caller = seedUser("caller_" + tag(), "HUMAN");
    long agent = seedUser("agent_" + tag(), "AGENT");

    List<ContactSummary> rows = repo.findPage(caller, null, "ALL", false, null, 100);

    assertThat(rows).extracting(ContactSummary::id).doesNotContain(agent);
  }

  @Test
  void list_typeFilter_externalOnly() {
    long caller = seedUser("c_" + tag(), "HUMAN");
    // 고유 prefix 로 검색해 시드 외부 1건만 결정적으로 매칭(공유 DB 의 다른 외부 배제).
    String p = "tfx" + tag();
    long e = seedExternal(p + "_ext", "SHARED", caller);

    List<ContactSummary> rows = repo.findPage(caller, p, "EXTERNAL", false, null, 100);

    assertThat(rows).isNotEmpty();
    assertThat(rows).allMatch(r -> r.type().equals("EXTERNAL"));
    assertThat(rows).extracting(ContactSummary::id).contains(e);
  }

  @Test
  void list_searchMatchesNameCaseInsensitive() {
    long caller = seedUser("c_" + tag(), "HUMAN");
    String uniq = "Zenith" + tag();
    long e = seedExternal(uniq, "SHARED", caller);

    List<ContactSummary> rows = repo.findPage(caller, uniq.toLowerCase(), "ALL", false, null, 100);

    assertThat(rows).extracting(ContactSummary::id).containsExactly(e);
  }

  @Test
  void list_personalExternal_hiddenFromNonOwner() {
    long owner = seedUser("owner_" + tag(), "HUMAN");
    long other = seedUser("other_" + tag(), "HUMAN");
    String uniq = "Secret" + tag();
    seedExternal(uniq, "PERSONAL", owner);

    List<ContactSummary> ownerView = repo.findPage(owner, uniq, "ALL", false, null, 100);
    List<ContactSummary> otherView = repo.findPage(other, uniq, "ALL", false, null, 100);

    assertThat(ownerView).hasSize(1);
    assertThat(otherView).isEmpty();
  }

  @Test
  void getMember_returnsProfileAndGroups() {
    long u = seedUser("Mem" + tag(), "HUMAN");
    dsl.update(USER).set(USER.TITLE, "팀장").where(USER.ID.eq(u)).execute();
    long g =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, "개발팀_" + tag())
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, g)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, u)
        .execute();

    Optional<MemberDetail> d = repo.findMember(u, u);

    assertThat(d).isPresent();
    assertThat(d.get().title()).isEqualTo("팀장");
    assertThat(d.get().groups()).anyMatch(n -> n.startsWith("개발팀_"));
  }

  @Test
  void getMember_agentOrMissing_empty() {
    long agent = seedUser("ag_" + tag(), "AGENT");
    assertThat(repo.findMember(agent, agent)).isEmpty();
    assertThat(repo.findMember(agent, 99_999_999L)).isEmpty();
  }

  @Test
  void getExternal_sharedVisibleToAnyone_personalOwnerOnly() {
    long owner = seedUser("o_" + tag(), "HUMAN");
    long other = seedUser("ot_" + tag(), "HUMAN");
    long shared = seedExternal("Sh" + tag(), "SHARED", owner);
    long personal = seedExternal("Pe" + tag(), "PERSONAL", owner);

    assertThat(repo.findExternal(other, false, shared)).isPresent();
    assertThat(repo.findExternal(other, false, personal)).isEmpty();
    assertThat(repo.findExternal(owner, false, personal)).isPresent();
  }

  // === Task A4 추가: 쓰기 + editable ===

  @Test
  void insert_thenFindExternal_returnsRow_editableForOwner() {
    long owner = seedUser("R_" + tag(), "HUMAN");
    long id =
        repo.insert(
            owner,
            new ExternalContactRequest("박외부", "park@corp.com", "", "Corp", "", "  ", "PERSONAL"));
    var found = repo.findExternal(owner, false, id);
    org.assertj.core.api.Assertions.assertThat(found).isPresent();
    org.assertj.core.api.Assertions.assertThat(found.get().name()).isEqualTo("박외부");
    // 빈/공백 optional 은 null 정규화
    org.assertj.core.api.Assertions.assertThat(found.get().phone()).isNull();
    org.assertj.core.api.Assertions.assertThat(found.get().notes()).isNull();
    org.assertj.core.api.Assertions.assertThat(found.get().editable()).isTrue();
  }

  @Test
  void findExternal_sharedByNonOwner_editableFalse_unlessAdmin() {
    long owner = seedUser("R_" + tag(), "HUMAN");
    long other = seedUser("R_" + tag(), "HUMAN");
    long id =
        repo.insert(
            owner, new ExternalContactRequest("공유연락처", null, null, null, null, null, "SHARED"));
    org.assertj.core.api.Assertions.assertThat(repo.findExternal(other, false, id).get().editable())
        .isFalse();
    org.assertj.core.api.Assertions.assertThat(repo.findExternal(other, true, id).get().editable())
        .isTrue();
  }

  @Test
  void update_replacesFields() {
    long owner = seedUser("R_" + tag(), "HUMAN");
    long id =
        repo.insert(
            owner, new ExternalContactRequest("old", null, null, null, null, null, "PERSONAL"));
    repo.update(
        id, new ExternalContactRequest("new", "new@x.com", null, null, null, null, "SHARED"));
    var f = repo.findExternal(owner, false, id).get();
    org.assertj.core.api.Assertions.assertThat(f.name()).isEqualTo("new");
    org.assertj.core.api.Assertions.assertThat(f.visibility()).isEqualTo("SHARED");
  }

  @Test
  void delete_removesRow() {
    long owner = seedUser("R_" + tag(), "HUMAN");
    long id =
        repo.insert(
            owner, new ExternalContactRequest("tmp", null, null, null, null, null, "PERSONAL"));
    repo.delete(id);
    org.assertj.core.api.Assertions.assertThat(repo.findOwnerVisibility(id)).isEmpty();
  }

  @Test
  void list_keysetCursor_continuesStrictlyAfter() {
    long caller = seedUser("kc_caller_" + tag(), "HUMAN");
    // 고유 prefix 로 검색 → 시드한 3건만 매칭(공유 test DB 의 다른 데이터 배제). 이름 정렬: _a < _b < _c
    String p = "kcur" + tag();
    long a = seedExternal(p + "_a", "SHARED", caller);
    long b = seedExternal(p + "_b", "SHARED", caller);
    long c = seedExternal(p + "_c", "SHARED", caller);

    // 1페이지: limit 2 → [a, b]
    List<ContactSummary> page1 = repo.findPage(caller, p, "EXTERNAL", false, null, 2);
    assertThat(page1).extracting(ContactSummary::id).containsExactly(a, b);

    // 마지막 표시행으로 커서 구성 → 2페이지는 그 다음(c)부터, 겹침 없이
    ContactSummary last = page1.get(page1.size() - 1);
    ContactCursorCodec.Decoded cursor =
        new ContactCursorCodec.Decoded(last.name(), last.type(), last.id());
    List<ContactSummary> page2 = repo.findPage(caller, p, "EXTERNAL", false, cursor, 2);
    assertThat(page2).extracting(ContactSummary::id).containsExactly(c);
    assertThat(page2).extracting(ContactSummary::id).doesNotContain(a, b);
  }
}
