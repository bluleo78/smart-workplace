package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채팅 시 비서 해석이 외부 ai-agent 호출보다 먼저 일어남을 검증. 비서 미설정 caller 는 503(HomeAssistantNotConfiguredException)
 * 로 단락된다. 테스트 프로파일 기본 enabled=false 라 resolver 경로를 타려면 enabled=true 로 override 한다.
 */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeChatServiceAssistantTest extends IntegrationTestBase {

  @Autowired HomeChatService service;
  @Autowired DSLContext dsl;

  @Test
  void 비서_미설정_caller_는_startChat_시_미설정예외() {
    long human = TestFixtures.createHuman(dsl);
    // startChat 은 비서 해석을 요청 스레드에서 동기 수행하므로 생성 시작 전에 예외가 던져진다.
    assertThatThrownBy(() -> service.startChat(human, null, "안녕"))
        .isInstanceOf(HomeAssistantNotConfiguredException.class);
  }
}
