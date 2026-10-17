package com.workplace.global.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@code /actuator/info} 가 앱 버전·커밋을 인증 없이 알려주는지 검증한다(WP-439).
 *
 * <p>배포 후 "새 이미지가 실제로 반영됐는지"를 이미지 태그가 아닌 실행 중인 앱에게 직접 물어 확인하기 위한 엔드포인트다. 빌드 인자({@code
 * APP_VERSION}·{@code GIT_SHA})가 없는 테스트·로컬 환경에서는 기본값 {@code dev} 가 나와야 한다.
 */
class ActuatorInfoIntegrationTest extends IntegrationTestBase {

  @Autowired private MockMvc mockMvc;

  @Test
  void 인증_없이_앱_버전과_커밋을_돌려준다() throws Exception {
    mockMvc
        .perform(get("/actuator/info"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.app.version").value("dev"))
        .andExpect(jsonPath("$.app.commit").value("dev"));
  }
}
