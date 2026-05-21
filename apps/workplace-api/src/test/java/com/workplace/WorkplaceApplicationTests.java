package com.workplace;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** Spring 컨텍스트 로딩 스모크 테스트. */
@SpringBootTest
@ActiveProfiles("test")
class WorkplaceApplicationTests {

  @Test
  void contextLoads() {}
}
