package com.workplace.agentruntime.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 내부 실행 설정(WP-1245) — {@code workplace.agent-runtime.*}.
 *
 * @param allowedImagePrefixes 실행 템플릿이 쓸 수 있는 컨테이너 이미지 접두사. 템플릿 YAML 이 엉뚱한 레지스트리의 이미지를 가리켜 특권 컨테이너로
 *     뜨는 일을 시작 때 막는다. 비어 있으면 기본값(자체 레지스트리 + 도커 공식 dind)을 쓴다.
 */
@ConfigurationProperties("workplace.agent-runtime")
public record AgentRuntimeProperties(List<String> allowedImagePrefixes) {

  /** 설정이 없을 때의 기본 허용 접두사. */
  public static final List<String> DEFAULT_ALLOWED_IMAGE_PREFIXES =
      List.of("ghcr.io/bluleo78/", "docker:");

  public AgentRuntimeProperties {
    allowedImagePrefixes =
        allowedImagePrefixes == null || allowedImagePrefixes.isEmpty()
            ? DEFAULT_ALLOWED_IMAGE_PREFIXES
            : List.copyOf(allowedImagePrefixes);
  }
}
