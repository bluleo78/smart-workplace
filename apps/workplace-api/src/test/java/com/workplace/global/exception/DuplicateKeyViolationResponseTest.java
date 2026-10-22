package com.workplace.global.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import com.workplace.global.dto.ErrorResponse;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.annotation.Transactional;

/**
 * 유일 인덱스 위반 응답(WP-765) — 같은 이름의 폴더·채널·프로젝트 key·팀 공간·그룹을 동시에 만들거나 같은 멤버를 동시에 넣으면, 진 쪽은 서비스의 중복 확인을
 * 지난 뒤 유일 인덱스에 걸린다. 이때 영어 「Data integrity violation: duplicate entry」 대신 한국어 409 로 나가야 한다(문구는
 * WP-705 에서 바뀌었고, 이 테스트가 되돌아가지 않게 붙잡는다). 실제 DB 가 내는 예외로 확인한다.
 */
@Transactional
class DuplicateKeyViolationResponseTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectRepository projectRepository;

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
  private final MockHttpServletRequest request =
      new MockHttpServletRequest("POST", "/api/v1/projects");

  @Test
  void 유일_인덱스에_걸린_동시_생성은_한국어_409() {
    long owner = TestFixtures.createHuman(dsl);
    String key = "D" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectRepository.insert(key, "앞선 생성", null, owner, "TEAM", false);
    // 서비스의 key 중복 확인을 이미 지난 늦은 요청이 그대로 넣는 상황 — 유일 인덱스가 막는다.
    var ex =
        catchThrowableOfType(
            DataIntegrityViolationException.class,
            () -> projectRepository.insert(key, "늦은 생성", null, owner, "TEAM", false));

    ResponseEntity<ErrorResponse> res = handler.handleDataIntegrityViolation(ex, request);

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(res.getBody().message()).isEqualTo("이미 있는 항목과 겹쳐 처리하지 못했습니다");
  }
}
