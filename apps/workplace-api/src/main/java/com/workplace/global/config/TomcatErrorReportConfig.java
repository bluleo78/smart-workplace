package com.workplace.global.config;

import org.apache.catalina.Valve;
import org.apache.catalina.core.StandardHost;
import org.apache.catalina.valves.ErrorReportValve;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 내장 Tomcat 의 오류 보고 밸브를 {@link JsonErrorReportValve} 로 바꾼다(WP-732).
 *
 * <p>Tomcat 은 매핑 전에 거절한 요청의 오류 페이지를 호스트 파이프라인의 첫 ErrorReportValve 로 쓴다. Spring Boot 가 이미 기본 밸브를 넣어
 * 두므로(스택 숨김용) 그것을 빼고 JSON 밸브를 넣는다 — 둘을 함께 두면 앞의 기본 밸브가 영어 HTML 을 쓴다. 호스트가 시작할 때 기본 밸브를 다시 넣지 않도록
 * errorReportValveClass 도 바꾼다. Spring Boot 의 같은 자리 설정보다 뒤에 돌도록 기본 순서(가장 낮은 우선순위)를 둔다.
 */
@Configuration
public class TomcatErrorReportConfig {

  @Bean
  WebServerFactoryCustomizer<TomcatServletWebServerFactory> jsonErrorReportValveCustomizer() {
    return factory ->
        factory.addContextCustomizers(
            context -> {
              if (!(context.getParent() instanceof StandardHost host)) {
                return;
              }
              host.setErrorReportValveClass(JsonErrorReportValve.class.getName());
              for (Valve valve : host.getPipeline().getValves()) {
                if (valve instanceof ErrorReportValve && !(valve instanceof JsonErrorReportValve)) {
                  host.getPipeline().removeValve(valve);
                }
              }
              boolean present = false;
              for (Valve valve : host.getPipeline().getValves()) {
                present |= valve instanceof JsonErrorReportValve;
              }
              if (!present) {
                host.getPipeline().addValve(new JsonErrorReportValve());
              }
            });
  }
}
