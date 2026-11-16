package com.workplace.support;

import com.workplace.global.outbound.AiAgentProperties;
import org.mockito.Mockito;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 테스트용 AI 연동 끄기(WP-1640) — 공유 컨텍스트의 빈 하나만 잠시 「연동 꺼짐」 설정을 보게 하고 끝나면 되돌린다. 속성을 클래스마다 끄면 컨텍스트가 갈리므로 빈의
 * {@code aiAgentProperties} 필드만 바꾼다(필드 이름이 이것인 빈에만 쓴다).
 */
public final class AiAgentSwitch {

  private static final String FIELD = "aiAgentProperties";

  private AiAgentSwitch() {}

  /** bean 이 연동 꺼짐을 보는 동안 body 를 실행한다. 끝나면(예외여도) 원래 설정으로 되돌린다. */
  public static void whileDisabled(Object bean, Runnable body) {
    Object target = AopTestUtils.getUltimateTargetObject(bean);
    Object original = ReflectionTestUtils.getField(target, FIELD);
    // 목의 enabled() 기본값이 false — 연동 꺼짐.
    ReflectionTestUtils.setField(target, FIELD, Mockito.mock(AiAgentProperties.class));
    try {
      body.run();
    } finally {
      ReflectionTestUtils.setField(target, FIELD, original);
    }
  }
}
