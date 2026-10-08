package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.codeUnits;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaCodeUnit;
import com.tngtech.archunit.core.domain.JavaConstructor;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.workplace.global.outbound.InternalHttp;
import java.net.http.HttpClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * 내부 서비스 호출 클라이언트({@code ..outbound..})는 HTTP 클라이언트를 {@link InternalHttp} 로만 만든다(WP-305).
 *
 * <p>배경: JDK HttpClient 기본(HTTP/2)은 평문 요청에 h2c 업그레이드 헤더를 붙여, 상대(Node·uvicorn·프록시)가 404/400 으로 거절할 수
 * 있다. 클라이언트마다 따로 HTTP/1.1 을 고정하면 새 클라이언트가 빠뜨리므로(WP-172 이후에도 10여 곳 누락) 공용 생성 지점 밖의 직접 생성을 막는다.
 *
 * <p>범위 밖(사유): 외부 HTTPS 클라이언트 — {@code WebPushGateway}(notify.push), {@code
 * M365OidcClient}(auth.sso), {@code GraphApiConfig}(mail.config). h2c 는 평문에서만 쓰이고 HTTPS 는 ALPN 으로
 * HTTP/2 를 협상하므로 고정 대상이 아니다. 이들은 {@code ..outbound..} 패키지 밖이라 규칙에 걸리지 않는다.
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.DoNotIncludeTests.class)
public class InternalHttpArchTest {

  @ArchTest
  public static final ArchRule 내부_클라이언트는_공용_생성_지점으로_HTTP_클라이언트를_만든다 =
      noClasses()
          .that()
          .resideInAPackage("..outbound..")
          .and()
          .doNotBelongToAnyOf(InternalHttp.class)
          .should()
          .callMethod(HttpClient.class, "newBuilder")
          .orShould()
          .callMethod(HttpClient.class, "newHttpClient")
          .orShould()
          .callMethod(ClientHttpRequestFactoryBuilder.class, "detect")
          .orShould()
          .callMethod(ClientHttpRequestFactoryBuilder.class, "jdk")
          .orShould()
          .callConstructor(JdkClientHttpRequestFactory.class)
          .orShould()
          .callConstructor(JdkClientHttpRequestFactory.class, HttpClient.class)
          .because("평문 HTTP 내부 호출은 HTTP/1.1 고정이어야 한다 — h2c 업그레이드 헤더 오인 404/400 방지(WP-305)");

  /** RestClient 의 정적 생성 메서드(builder/create) 호출 — 팩토리 미지정이면 기본 JDK(HTTP/2) 팩토리가 붙는다. */
  private static final DescribedPredicate<JavaMethodCall> RESTCLIENT_FACTORY_CALL =
      DescribedPredicate.describe(
          "RestClient.builder(..)/create(..) 호출",
          call ->
              call.getTargetOwner().isEquivalentTo(RestClient.class)
                  && (call.getName().equals("builder") || call.getName().equals("create")));

  @ArchTest
  public static final ArchRule 내부_클라이언트는_RestClient_를_직접_만들지_않는다 =
      noClasses()
          .that()
          .resideInAPackage("..outbound..")
          .and()
          .doNotBelongToAnyOf(InternalHttp.class)
          .should()
          .callMethodWhere(RESTCLIENT_FACTORY_CALL)
          .because(
              "RestClient 는 InternalHttp.restClient(..) 로만 만든다 — HTTP/1.1·리다이렉트 미추종 고정(WP-305)");

  /** 스프링이 인자를 주입하는 코드 단위 — @Bean·@Autowired 메서드/생성자, 스프링 컴포넌트(@Configuration 포함)의 생성자. */
  private static final DescribedPredicate<JavaCodeUnit> SPRING_INJECTED =
      DescribedPredicate.describe(
          "스프링이 인자를 주입하는",
          cu ->
              cu.isAnnotatedWith(Bean.class)
                  || cu.isAnnotatedWith(Autowired.class)
                  || (cu instanceof JavaConstructor
                      && cu.getOwner().isMetaAnnotatedWith(Component.class)));

  /**
   * 부트 자동 구성 {@code RestClient.Builder} 빈 주입 금지 — 그 빈의 요청 팩토리는 HTTP/1.1 고정이 아니다. 내부 클라이언트 생성자가
   * Builder 를 인자로 받는 것은 설정이 InternalHttp 로 만든 것을 넘기는 것이라 허용한다(스프링 주입 지점만 막는다).
   */
  @ArchTest
  public static final ArchRule 내부_클라이언트는_RestClient_Builder_빈을_주입받지_않는다 =
      codeUnits()
          .that()
          .areDeclaredInClassesThat()
          .resideInAPackage("..outbound..")
          .and(SPRING_INJECTED)
          .should(
              ArchCondition.from(
                  DescribedPredicate.describe(
                      "RestClient.Builder 를 인자로 받지 않는다",
                      (JavaCodeUnit cu) ->
                          cu.getRawParameterTypes().stream()
                              .noneMatch(t -> t.isEquivalentTo(RestClient.Builder.class)))))
          .because("주입된 RestClient.Builder 는 HTTP/1.1 고정 팩토리가 아니다(WP-305)");
}
