package com.workplace.global.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.web.servlet.MultipartProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.multipart.MultipartResolver;
import org.springframework.web.servlet.DispatcherServlet;

/**
 * 멀티파트 해석기 등록(WP-1074) — Boot 기본(StandardServletMultipartResolver) 대신 브라우저 파일명 이스케이프를 되돌리는 해석기를 쓴다.
 * 이 빈이 있으면 Boot 자동 설정은 해석기를 만들지 않으므로, Boot 가 넣던 설정(spring.servlet.multipart.*)을 같은 값으로 옮겨 넣는다. 크기
 * 한도 등 MultipartConfigElement 는 Boot 자동 설정이 그대로 만든다. 멀티파트 자동 설정이 꺼져 설정 빈이 없으면 기본값으로 만든다.
 */
@Configuration
public class MultipartConfig {

  @Bean(name = DispatcherServlet.MULTIPART_RESOLVER_BEAN_NAME)
  public MultipartResolver multipartResolver(ObjectProvider<MultipartProperties> properties) {
    MultipartProperties props = properties.getIfAvailable(MultipartProperties::new);
    BrowserFileNameMultipartResolver resolver = new BrowserFileNameMultipartResolver();
    resolver.setResolveLazily(props.isResolveLazily());
    resolver.setStrictServletCompliance(props.isStrictServletCompliance());
    return resolver;
  }
}
