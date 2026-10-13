package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.io.ClassPathResource;

/**
 * 운영 공개 웹 주소 기동 검사(WP-369, R5). 규칙은 순수 함수로, 프로필 연결은 가벼운 {@link ApplicationContextRunner} 로 검증한다 —
 * 실제 prod 프로필 전체를 띄우지 않는다(DB·시크릿 불필요).
 */
class PublicBaseUrlCheckTest {

  private final ApplicationContextRunner runner =
      new ApplicationContextRunner().withUserConfiguration(PublicBaseUrlCheck.class);

  @Test
  void rejects_blankOrLocalhostOrNonHttp() {
    assertThat(PublicBaseUrlCheck.problemOf(null)).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("   ")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://localhost:6173")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("https://LOCALHOST")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://127.0.0.1:10000")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://[::1]:8080")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://0.0.0.0")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://web.localhost")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("genia-works.iacloud.kr")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("ftp://genia-works.iacloud.kr")).isNotNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://exa mple.com")).isNotNull();
  }

  @Test
  void accepts_publicHttpUrl() {
    assertThat(PublicBaseUrlCheck.problemOf("https://genia-works.iacloud.kr")).isNull();
    assertThat(PublicBaseUrlCheck.problemOf("https://genia-works.iacloud.kr/")).isNull();
    assertThat(PublicBaseUrlCheck.problemOf("http://10.0.0.5:10000")).isNull();
  }

  @Test
  void constructor_throwsOnBadValue() {
    assertThatThrownBy(() -> new PublicBaseUrlCheck("http://localhost:6173"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("WEB_BASE_URL");
    new PublicBaseUrlCheck("https://genia-works.iacloud.kr");
  }

  /** prod 프로필에서 값이 없거나 localhost 면 컨텍스트 기동이 실패한다. */
  @Test
  void prodProfile_failsStartup_whenMissingOrLocalhost() {
    runner
        .withPropertyValues("spring.profiles.active=prod")
        .run(ctx -> assertThat(ctx).hasFailed());
    runner
        .withPropertyValues(
            "spring.profiles.active=prod", "workplace.public-base-url=http://localhost:6173")
        .run(ctx -> assertThat(ctx).hasFailed());
    runner
        .withPropertyValues(
            "spring.profiles.active=prod",
            "workplace.public-base-url=https://genia-works.iacloud.kr")
        .run(ctx -> assertThat(ctx).hasNotFailed().hasSingleBean(PublicBaseUrlCheck.class));
  }

  /** 기본값 localhost 는 base(local·test)에만 있고, prod 프로필 yml 은 기본값을 비워 검사에 걸리게 한다. */
  @Test
  void yaml_defaultsAreLocalOnly() throws Exception {
    YamlPropertySourceLoader loader = new YamlPropertySourceLoader();
    Object base =
        loader
            .load("base", new ClassPathResource("application.yml"))
            .get(0)
            .getProperty("workplace.public-base-url");
    Object prod =
        loader
            .load("prod", new ClassPathResource("application-prod.yml"))
            .get(0)
            .getProperty("workplace.public-base-url");
    assertThat(String.valueOf(base)).isEqualTo("${WEB_BASE_URL:http://localhost:6173}");
    assertThat(String.valueOf(prod)).isEqualTo("${WEB_BASE_URL:}");
  }

  /** prod 가 아니면(local·test) 검사 빈 자체가 없어 localhost 기본값으로 기동한다. */
  @Test
  void nonProdProfile_skipsCheck() {
    runner
        .withPropertyValues(
            "spring.profiles.active=local", "workplace.public-base-url=http://localhost:6173")
        .run(ctx -> assertThat(ctx).hasNotFailed().doesNotHaveBean(PublicBaseUrlCheck.class));
  }
}
