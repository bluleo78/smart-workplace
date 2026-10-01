package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.mail.dto.UserMailProfile;
import com.workplace.mail.repository.MailPeopleRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

/** WP-150 "나" 프로필 — 다계정 주소 + user.email, 이름·다른 이름·직함, 공유 조직도 소속만, 조회 실패 처리, 배치 캐시. */
@Transactional
class UserMailProfileBuilderTest extends IntegrationTestBase {

  @Autowired UserMailProfileBuilder builder;
  @Autowired DSLContext dsl;
  @MockitoSpyBean MailPeopleRepository peopleRepo;

  @Test
  void build_collectsAllAddressesNamesTitleAndSharedGroups() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    MailPeopleFixtures.setProfile(dsl, box.userId(), "홍길동", "팀장");
    MailPeopleFixtures.addAccount(dsl, box.userId(), "  GD@Gmail.com ", "Gildong Hong");
    String dev = "개발팀-" + System.nanoTime();
    MailPeopleFixtures.sharedGroup(dsl, dev, box.userId());
    MailPeopleFixtures.sharedGroup(dsl, "다른팀-" + System.nanoTime()); // 나는 소속 아님
    long other = TestFixtures.createHuman(dsl);
    // 다른 사람의 개인 그룹에 내가 들어 있어도 내 소속이 아니다
    MailPeopleFixtures.personalGroup(dsl, other, "남의그룹-" + System.nanoTime(), box.userId());

    UserMailProfile p = builder.build(box.userId());

    assertThat(p.addresses())
        .containsExactly(
            box.address(),
            "gd@gmail.com",
            MailPeopleFixtures.userEmail(dsl, box.userId()).toLowerCase());
    assertThat(p.name()).isEqualTo("홍길동");
    assertThat(p.otherNames()).containsExactly("Gildong Hong");
    assertThat(p.title()).isEqualTo("팀장");
    assertThat(p.groups()).containsExactly(dev);
  }

  @Test
  void build_userEmailSameAsAccount_deduplicated() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    String userEmail = MailPeopleFixtures.userEmail(dsl, box.userId());
    MailPeopleFixtures.addAccount(dsl, box.userId(), userEmail.toUpperCase(), null);

    UserMailProfile p = builder.build(box.userId());

    assertThat(p.addresses()).containsExactly(box.address(), userEmail.toLowerCase());
  }

  @Test
  void build_otherNames_caseInsensitiveDedup_keepsFirstSpelling() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    MailPeopleFixtures.setProfile(dsl, box.userId(), "홍길동", null);
    long n = System.nanoTime();
    MailPeopleFixtures.addAccount(dsl, box.userId(), "a" + n + "@x.com", "Gildong Hong");
    MailPeopleFixtures.addAccount(dsl, box.userId(), "b" + n + "@x.com", "GILDONG HONG");
    MailPeopleFixtures.addAccount(dsl, box.userId(), "c" + n + "@x.com", "Gil");

    UserMailProfile p = builder.build(box.userId());

    assertThat(p.otherNames()).containsExactly("Gildong Hong", "Gil");
  }

  @Test
  void build_blankName_fallsBackToAccountDisplayName() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    MailPeopleFixtures.setProfile(dsl, box.userId(), " ", null);
    MailPeopleFixtures.addAccount(
        dsl, box.userId(), "alias-" + System.nanoTime() + "@x.com", "Gildong Hong");

    UserMailProfile p = builder.build(box.userId());

    assertThat(p.name()).isEqualTo("Gildong Hong");
    assertThat(p.otherNames()).isEmpty();
    assertThat(p.title()).isNull();
  }

  @Test
  void build_profileLookupFails_keepsAddresses() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    MailPeopleFixtures.setProfile(dsl, box.userId(), "홍길동", "팀장");
    doThrow(new RuntimeException("boom")).when(peopleRepo).findProfileBasics(box.userId());

    UserMailProfile p = builder.build(box.userId());

    assertThat(p.name()).isNull();
    assertThat(p.groups()).isEmpty();
    assertThat(p.addresses()).contains(box.address());
  }

  @Test
  void build_addressLookupFails_throws() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    doThrow(new IllegalStateException("db")).when(peopleRepo).listOwnAddresses(box.userId());

    assertThatThrownBy(() -> builder.build(box.userId())).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void cache_buildsOncePerUserPerBatch() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    UserMailProfileCache cache = builder.newCache();

    UserMailProfile first = cache.get(box.userId());
    UserMailProfile second = cache.get(box.userId());
    builder.newCache().get(box.userId()); // 새 배치는 다시 읽는다

    assertThat(second).isSameAs(first);
    verify(peopleRepo, times(2)).listOwnAddresses(box.userId());
  }
}
