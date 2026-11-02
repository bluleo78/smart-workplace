package com.workplace.agentruntime;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.service.RepoHosts;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** WP-1268 저장소 호스트 규칙 단위 테스트 — URL 에서 호스트만 뽑기와 등록 호스트 정규화. */
class RepoHostsTest {

  /** https·http·ssh(포트 포함)·scp 꼴 모두 소문자 호스트만 남긴다. */
  @Test
  void hostOf_whenKnownUrlForms_returnsLowercaseHostOnly() {
    assertThat(RepoHosts.hostOf("https://GitHub.com/acme/repo.git")).isEqualTo("github.com");
    assertThat(RepoHosts.hostOf("http://gitlab.iacloud.kr/g/p")).isEqualTo("gitlab.iacloud.kr");
    assertThat(RepoHosts.hostOf("https://user:pw@git.example.com:8443/a/b"))
        .isEqualTo("git.example.com");
    assertThat(RepoHosts.hostOf("ssh://git@ghe.example.com:2222/acme/repo.git"))
        .isEqualTo("ghe.example.com");
    assertThat(RepoHosts.hostOf("ssh://git@ghe.example.com/acme/repo.git"))
        .isEqualTo("ghe.example.com");
    assertThat(RepoHosts.hostOf("git@github.com:acme/repo.git")).isEqualTo("github.com");
    assertThat(RepoHosts.hostOf("  https://github.com  ")).isEqualTo("github.com");
  }

  /** 못 읽는 입력은 null — 빈 값·모르는 스킴·경로뿐인 값·잘못된 호스트·잘못된 포트. */
  @Test
  void hostOf_whenUnreadable_returnsNull() {
    assertThat(RepoHosts.hostOf(null)).isNull();
    assertThat(RepoHosts.hostOf("")).isNull();
    assertThat(RepoHosts.hostOf("ftp://github.com/a/b")).isNull();
    assertThat(RepoHosts.hostOf("/local/path/repo")).isNull();
    assertThat(RepoHosts.hostOf("github.com/acme/repo")).isNull();
    assertThat(RepoHosts.hostOf("https:///acme/repo")).isNull();
    assertThat(RepoHosts.hostOf("https://bad_host.com/a")).isNull();
    assertThat(RepoHosts.hostOf("https://github.com:abc/a")).isNull();
  }

  /** 등록 호스트는 trim+소문자 뒤 호스트 이름 형식만 통과한다. */
  @Test
  void normalize_whenHostName_trimsAndLowercases_elseNull() {
    assertThat(RepoHosts.normalize("  GitHub.COM ")).isEqualTo("github.com");
    assertThat(RepoHosts.normalize("a-b.example.co.kr")).isEqualTo("a-b.example.co.kr");
    assertThat(RepoHosts.normalize("github.com:443")).isNull();
    assertThat(RepoHosts.normalize("https://github.com")).isNull();
    assertThat(RepoHosts.normalize("github.com/x")).isNull();
    assertThat(RepoHosts.normalize("-bad.com")).isNull();
    assertThat(RepoHosts.normalize("bad-.com")).isNull();
    assertThat(RepoHosts.normalize("")).isNull();
    assertThat(RepoHosts.normalize(null)).isNull();
    assertThat(RepoHosts.normalize("a".repeat(254))).isNull();
  }

  /** 호스트는 240자까지 — runner 의 Secret 키 repo-<kind>-<host> 가 쿠버네티스 키 상한 253자를 넘지 않게. */
  @Test
  void normalize_whenLongerThan240_returnsNull() {
    String label = "a".repeat(60);
    String host240 = String.join(".", label, label, label, "a".repeat(57));
    org.assertj.core.api.Assertions.assertThat(host240).hasSize(240);
    org.assertj.core.api.Assertions.assertThat(RepoHosts.normalize(host240)).isEqualTo(host240);
    org.assertj.core.api.Assertions.assertThat(RepoHosts.normalize(host240 + "a")).isNull();
  }

  /** 토큰이 없는 호스트만 오름차순·중복 없이 돌려주고, 읽을 수 없는 URL 은 건너뛴다. */
  @Test
  void missing_whenSomeHostsHaveTokens_returnsSortedUniqueRemaining() {
    assertThat(
            RepoHosts.missing(
                List.of(
                    "https://gitlab.example.com/a/b",
                    "git@github.com:acme/repo.git",
                    "https://github.com/acme/other",
                    "not a url",
                    "https://done.example.com/x"),
                Set.of("done.example.com")))
        .containsExactly("github.com", "gitlab.example.com");
    assertThat(RepoHosts.missing(List.of(), Set.of())).isEmpty();
  }
}
