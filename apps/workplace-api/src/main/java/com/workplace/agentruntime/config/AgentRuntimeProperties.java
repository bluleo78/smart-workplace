package com.workplace.agentruntime.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 내부 실행 설정(WP-1245) — {@code workplace.agent-runtime.*}.
 *
 * @param allowedImagePrefixes 실행 템플릿이 쓸 수 있는 컨테이너 이미지 접두사. 템플릿 YAML 이 엉뚱한 레지스트리의 이미지를 가리켜 특권 컨테이너로
 *     뜨는 일을 시작 때 막는다. 비어 있으면 기본값(자체 레지스트리 + 도커 공식 dind)을 쓴다.
 * @param mcpUrl runner 가 띄운 AI 가 붙을 MCP 주소(WP-1249) — 실행 위치(다른 클러스터일 수 있음)에서 닿는 주소여야 한다. desired
 *     응답에 실어 runner 가 Pod 환경으로 넘긴다. 비어 있으면 로컬 기본값.
 * @param apiUrl runner 가 띄운 AI 가 부를 REST 주소(WP-1249) — {@code /api/v1} 까지 포함한다(플러그인의 {@code
 *     GENIA_WORKS_API_URL} 에 그대로 들어가 {@code $api/events} 처럼 이어 붙인다). 비어 있으면 로컬 기본값.
 */
@ConfigurationProperties("workplace.agent-runtime")
public record AgentRuntimeProperties(
    List<String> allowedImagePrefixes, String mcpUrl, String apiUrl) {

  /** 설정이 없을 때의 기본 허용 접두사. */
  public static final List<String> DEFAULT_ALLOWED_IMAGE_PREFIXES =
      List.of("ghcr.io/bluleo78/", "docker:");

  /** 설정이 없을 때의 MCP 주소 — 로컬 workplace-mcp(6090). */
  public static final String DEFAULT_MCP_URL = "http://localhost:6090/mcp";

  /** 설정이 없을 때의 REST 주소 — 로컬 workplace-api(6060). */
  public static final String DEFAULT_API_URL = "http://localhost:6060/api/v1";

  public AgentRuntimeProperties {
    allowedImagePrefixes =
        allowedImagePrefixes == null || allowedImagePrefixes.isEmpty()
            ? DEFAULT_ALLOWED_IMAGE_PREFIXES
            : List.copyOf(allowedImagePrefixes);
    mcpUrl = mcpUrl == null || mcpUrl.isBlank() ? DEFAULT_MCP_URL : mcpUrl.strip();
    apiUrl = apiUrl == null || apiUrl.isBlank() ? DEFAULT_API_URL : apiUrl.strip();
  }
}
