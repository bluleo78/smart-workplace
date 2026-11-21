package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.codeUnits;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaAccess;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaCodeUnit;
import com.tngtech.archunit.core.domain.JavaConstructor;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import com.workplace.auth.outbound.AssistantModelsConfig;
import com.workplace.auth.sso.M365OidcClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import com.workplace.global.outbound.OutboundConfig;
import com.workplace.global.outbound.OutboundJson;
import java.net.http.HttpClient;
import java.util.function.Predicate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

/**
 * 내부 서비스 호출 클라이언트({@code ..outbound..})는 HTTP 클라이언트를 {@link InternalHttp} 로만 만든다(WP-305).
 *
 * <p>배경: JDK HttpClient 기본(HTTP/2)은 평문 요청에 h2c 업그레이드 헤더를 붙여, 상대(Node·uvicorn·프록시)가 404/400 으로 거절할 수
 * 있다. 클라이언트마다 따로 HTTP/1.1 을 고정하면 새 클라이언트가 빠뜨리므로(WP-172 이후에도 10여 곳 누락) 공용 생성 지점 밖의 직접 생성을 막는다.
 * RestClient 빌더의 출발점은 Jackson 2 기본값의 JSON 변환기를 고정한 {@code OutboundJson.restClientBuilder()}
 * 이고(WP-1608·WP-1609), 내부 클라이언트는 그것을 직접 쓰지 않고 그 위에 HTTP/1.1 팩토리를 얹는 {@link InternalHttp} 로 만든다.
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

  /**
   * 대상 클래스의 지정 멤버를 호출하거나 메서드·생성자 참조({@code RestClient::create} 등)로 쓰는 접근 조건.
   *
   * <p>왜: {@code callMethodWhere} 는 직접 호출만 보므로 {@code RestClient::builder} 같은 참조로 우회할 수 있다. {@code
   * getAccessesFromSelf()} 는 호출과 참조를 모두 담으므로 이것으로 함께 막는다.
   */
  private static ArchCondition<JavaClass> accessesTarget(
      String description, Predicate<JavaAccess<?>> matches) {
    return new ArchCondition<>(description) {
      @Override
      public void check(JavaClass clazz, ConditionEvents events) {
        for (JavaAccess<?> access : clazz.getAccessesFromSelf()) {
          if (matches.test(access)) {
            events.add(SimpleConditionEvent.satisfied(access, access.getDescription()));
          }
        }
      }
    };
  }

  /** RestClient 정적 생성 메서드(builder/create)의 호출 또는 메서드 참조. */
  private static final ArchCondition<JavaClass> USES_STATIC_RESTCLIENT_FACTORY =
      accessesTarget(
          "RestClient.builder()/create() 를 호출하거나 참조한다",
          a ->
              a.getTargetOwner().isEquivalentTo(RestClient.class)
                  && (a.getTarget().getName().equals("builder")
                      || a.getTarget().getName().equals("create")));

  /** RestTemplate(하위 클래스 포함)·RestTemplateBuilder 의 생성자 호출 또는 생성자 참조. */
  private static final ArchCondition<JavaClass> CONSTRUCTS_REST_TEMPLATE =
      accessesTarget(
          "RestTemplate/RestTemplateBuilder 를 생성한다",
          a ->
              // 바이트코드의 생성자 이름
              a.getTarget().getName().equals("<init>")
                  && (a.getTargetOwner().isAssignableTo(RestTemplate.class)
                      || a.getTargetOwner().isEquivalentTo(RestTemplateBuilder.class)));

  /**
   * 정적 {@code RestClient.builder()/create()}(메서드 참조 포함)는 {@link OutboundJson} 안에서만 쓴다 — 왜 Jackson 2
   * 기본값 고정이 필요한지는 {@link OutboundJson} 참조(WP-1608·WP-1609). 내부 평문 호출은 그 위에 {@link InternalHttp} 로
   * HTTP/1.1 을 고정한다(WP-305).
   */
  @ArchTest
  public static final ArchRule 정적_RestClient_는_OutboundJson_에서만_만든다 =
      noClasses()
          .that()
          .doNotBelongToAnyOf(OutboundJson.class)
          .should(USES_STATIC_RESTCLIENT_FACTORY)
          .because(
              "정적 RestClient 는 OutboundJson.restClientBuilder() 로 Jackson 2 기본값의 JSON 변환기를 고정한다(WP-1608·WP-1609) — 내부 호출은 InternalHttp.restClient(..)로 HTTP/1.1·리다이렉트 미추종도 고정(WP-305)");

  /** {@code OutboundJson.restClientBuilder()} 의 호출 또는 메서드 참조. */
  private static final ArchCondition<JavaClass> USES_OUTBOUND_JSON_BUILDER =
      accessesTarget(
          "OutboundJson.restClientBuilder() 를 호출하거나 참조한다",
          a ->
              a.getTargetOwner().isEquivalentTo(OutboundJson.class)
                  && a.getTarget().getName().equals("restClientBuilder"));

  /**
   * 내부 클라이언트({@code ..outbound..})는 {@code OutboundJson.restClientBuilder()} 를 직접 쓰지 않고 {@link
   * InternalHttp} 로 만든다(WP-305). OutboundJson 의 빌더는 요청 팩토리가 비어 있어 그대로 쓰면 기본 JDK(HTTP/2) 팩토리가 붙고, 평문
   * 내부 호출에 h2c 업그레이드 헤더가 다시 붙는다 — 위 규칙들은 팩토리를 아예 지정하지 않는 경우를 잡지 못한다.
   */
  @ArchTest
  public static final ArchRule 내부_클라이언트는_RestClient_를_InternalHttp_로만_만든다 =
      noClasses()
          .that()
          .resideInAPackage("..outbound..")
          .and()
          .doNotBelongToAnyOf(InternalHttp.class, OutboundJson.class)
          .should(USES_OUTBOUND_JSON_BUILDER)
          .because(
              "RestClient 는 InternalHttp.restClient(..)로만 만든다 — HTTP/1.1·리다이렉트 미추종 고정(WP-305)");

  /**
   * RestTemplate·RestTemplateBuilder 생성은 {@code M365OidcClient}(JWKS 전용 — 이유는 그 클래스 주석)에서만
   * 허용한다(WP-1608).
   */
  @ArchTest
  public static final ArchRule RestTemplate_은_M365OidcClient_에서만_만든다 =
      noClasses()
          .that()
          .doNotBelongToAnyOf(M365OidcClient.class)
          .should(CONSTRUCTS_REST_TEMPLATE)
          .because(
              "정적 RestTemplate 는 Boot 설정을 거치지 않은 Jackson 3 기본값 변환기를 쓴다 — JSON 을 쓰지 않는 JWKS 용 한 곳만 허용(WP-1608)");

  /** {@code InternalHttp.restClient(..)} 의 호출 또는 메서드 참조. */
  private static final ArchCondition<JavaClass> USES_INTERNAL_HTTP_REST_CLIENT =
      accessesTarget(
          "InternalHttp.restClient(..) 를 호출하거나 참조한다",
          a ->
              a.getTargetOwner().isEquivalentTo(InternalHttp.class)
                  && a.getTarget().getName().equals("restClient"));

  /**
   * ai-agent 호출 클라이언트({@link AiAgentProperties} 에 의존하는 {@code ..outbound..} 클래스)는 {@code
   * InternalHttp.restClient(..)} 를 직접 부르지 않고 {@code AiAgentHttp} 공장으로 만든다(WP-1829).
   *
   * <p>왜: 공장이 X-AI-Run 헤더(tenantId 등)와 닿기 전 실패 기록 인터셉터를 붙인다. 직접 만들면 헤더에 tenantId 가 없어 ai-agent 가 만든
   * AI 처리 기록이 버려지고 닿기 전 실패도 남지 않는다.
   *
   * <p>허용 목록: {@code OutboundConfig} 는 이벤트 클라이언트라 tenantId 만 담은 별도 헤더를 쓰는 설계 7번 예외이고, {@code
   * AssistantModelsConfig} 는 호출 경로가 AI 처리 종류 표(kinds)에 없어 기록 대상이 아니다.
   */
  @ArchTest
  public static final ArchRule ai_agent_클라이언트는_AiAgentHttp_공장으로_RestClient_를_만든다 =
      noClasses()
          .that()
          .resideInAPackage("..outbound..")
          .and(
              DescribedPredicate.describe(
                  "AiAgentProperties 에 의존하는",
                  (JavaClass c) ->
                      c.getDirectDependenciesFromSelf().stream()
                          .anyMatch(
                              d -> d.getTargetClass().isEquivalentTo(AiAgentProperties.class))))
          .and()
          .doNotBelongToAnyOf(OutboundConfig.class, AssistantModelsConfig.class)
          .should(USES_INTERNAL_HTTP_REST_CLIENT)
          .because("ai-agent 호출은 AiAgentHttp 공장으로 X-AI-Run 헤더·실패 기록을 붙여야 한다(WP-1829)");
}
