package com.workplace.mail.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.SenderRelation;
import com.workplace.mail.dto.SenderRelation.Kind;
import com.workplace.mail.dto.UserMailProfile;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-150 보낸 사람 관계 — 나 자신 · 사내 구성원(멤버십 기준, 타 테넌트·비활성 제외) · 같은 조직(공유 그룹만) · 외부 연락처(타인 PERSONAL 제외, 내
 * 것 우선) · 즐겨찾기 · 알 수 없음(도메인 추정 없음).
 */
@Transactional
class SenderRelationResolverTest extends IntegrationTestBase {

  @Autowired SenderRelationResolver resolver;
  @Autowired UserMailProfileBuilder builder;
  @Autowired DSLContext dsl;

  private Box box;
  private UserMailProfile me;
  private long n;

  @BeforeEach
  void seedMe() {
    box = MailAnalysisFixtures.mailbox(dsl, true);
    me = builder.build(box.userId());
    n = System.nanoTime();
  }

  @Test
  void self_byAccountOrUserEmail() {
    assertThat(resolver.resolve(me, box.address().toUpperCase()).kind()).isEqualTo(Kind.SELF);
    assertThat(resolver.resolve(me, MailPeopleFixtures.userEmail(dsl, box.userId())).kind())
        .isEqualTo(Kind.SELF);
  }

  @Test
  void member_byUserEmail_withSameSharedGroupAndFavorite() {
    long kim = MailPeopleFixtures.member(dsl, 1L, "minsu-" + n + "@acme.com", "김민수", "팀장");
    String dev = "개발팀-" + n;
    MailPeopleFixtures.sharedGroup(dsl, dev, box.userId(), kim);
    MailPeopleFixtures.sharedGroup(dsl, "영업팀-" + n, kim); // 나는 없음
    MailPeopleFixtures.personalGroup(
        dsl, box.userId(), "내분류-" + n, box.userId(), kim); // 개인 그룹은 조직 아님
    MailPeopleFixtures.favorite(dsl, box.userId(), "MEMBER", kim);

    SenderRelation r = resolver.resolve(me, " Minsu-" + n + "@ACME.com ");

    assertThat(r.kind()).isEqualTo(Kind.MEMBER);
    assertThat(r.name()).isEqualTo("김민수");
    assertThat(r.title()).isEqualTo("팀장");
    assertThat(r.sameGroups()).containsExactly(dev);
    assertThat(r.favorite()).isTrue();
  }

  @Test
  void member_byMailAccountAddress() {
    long lee = MailPeopleFixtures.member(dsl, 1L, "lee-" + n + "@corp.local", "이영희", null);
    MailPeopleFixtures.addAccount(dsl, lee, "lee.personal-" + n + "@gmail.com", null);

    SenderRelation r = resolver.resolve(me, "lee.personal-" + n + "@gmail.com");

    assertThat(r.kind()).isEqualTo(Kind.MEMBER);
    assertThat(r.name()).isEqualTo("이영희");
    assertThat(r.sameGroups()).isEmpty();
    assertThat(r.favorite()).isFalse();
  }

  @Test
  void userInOtherTenant_isNotMember() {
    long t2 = MailPeopleFixtures.tenant(dsl);
    MailPeopleFixtures.member(dsl, t2, "outsider-" + n + "@acme.com", "외부인", "사장");

    assertThat(resolver.resolve(me, "outsider-" + n + "@acme.com").kind()).isEqualTo(Kind.UNKNOWN);
  }

  @Test
  void inactiveOrSuspended_isNotMember() {
    long gone = MailPeopleFixtures.member(dsl, 1L, "gone-" + n + "@acme.com", "퇴사자", null);
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(gone)).execute();

    assertThat(resolver.resolve(me, "gone-" + n + "@acme.com").kind()).isEqualTo(Kind.UNKNOWN);
  }

  @Test
  void contact_ownPersonalPreferredOverShared() {
    long other = TestFixtures.createHuman(dsl);
    String email = "jane-" + n + "@partner.com";
    MailPeopleFixtures.contact(dsl, other, "SHARED", email, "공유 이름", "ACME", "과장");
    long own =
        MailPeopleFixtures.contact(
            dsl, box.userId(), "PERSONAL", email, "내 이름", "ACME Korea", "차장");
    MailPeopleFixtures.favorite(dsl, box.userId(), "EXTERNAL", own);

    SenderRelation r = resolver.resolve(me, email.toUpperCase());

    assertThat(r.kind()).isEqualTo(Kind.CONTACT);
    assertThat(r.name()).isEqualTo("내 이름");
    assertThat(r.organization()).isEqualTo("ACME Korea");
    assertThat(r.title()).isEqualTo("차장");
    assertThat(r.favorite()).isTrue();
  }

  @Test
  void contact_sharedVisible() {
    long other = TestFixtures.createHuman(dsl);
    String email = "bob-" + n + "@partner.com";
    MailPeopleFixtures.contact(dsl, other, "SHARED", email, "Bob", "Partner", null);

    SenderRelation r = resolver.resolve(me, email);

    assertThat(r.kind()).isEqualTo(Kind.CONTACT);
    assertThat(r.favorite()).isFalse();
  }

  @Test
  void contact_othersPersonal_excluded() {
    long other = TestFixtures.createHuman(dsl);
    String email = "secret-" + n + "@partner.com";
    MailPeopleFixtures.contact(dsl, other, "PERSONAL", email, "남의 연락처", "X", null);

    assertThat(resolver.resolve(me, email).kind()).isEqualTo(Kind.UNKNOWN);
  }

  @Test
  void unknown_noDomainGuessing() {
    MailPeopleFixtures.member(dsl, 1L, "a-" + n + "@acme.com", "구성원", null);

    assertThat(resolver.resolve(me, "b-" + n + "@acme.com").kind()).isEqualTo(Kind.UNKNOWN);
  }

  @Test
  void blankAddress_unknown() {
    assertThat(resolver.resolve(me, "  ").kind()).isEqualTo(Kind.UNKNOWN);
    assertThat(resolver.resolve(me, null).kind()).isEqualTo(Kind.UNKNOWN);
  }
}
