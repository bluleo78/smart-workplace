package com.workplace;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/**
 * Spring 컨텍스트 로딩 스모크 테스트.
 *
 * <p>테스트 프로파일은 빈 생성을 미루므로(lazy-initialization, WP-1028) 다른 테스트는 쓰지 않는 빈의 생성 실패를 놓친다. 이 테스트만 모든 빈을
 * 바로 만들어 운영과 같은 기동 실패를 잡는다.
 */
@TestPropertySource(properties = "spring.main.lazy-initialization=false")
class WorkplaceApplicationTests extends IntegrationTestBase {

  @Test
  void contextLoads() {}
}
