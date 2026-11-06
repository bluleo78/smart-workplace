-- 사이클 이름 — 대소문자만 다른 이름도 중복으로 막는다(WP-1393).
-- cycle 은 UNIQUE(project_id, name)(V26) 이라 「R65-Cy」「r65-cy」 가 둘 다 만들어져 사이클 목록·이슈 속성 선택에 같은 이름이 둘로
-- 보였다. 같은 프로젝트의 라벨·마일스톤(V210, WP-911)·구성요소·버전처럼 lower(name) 유니크 인덱스로 바꾼다.
-- 서비스는 원래대로 DuplicateKeyException 을 409(CycleNameDuplicatedException)로 바꾸므로 생성·이름 변경 모두 같은 문구로 거절된다.

-- 인덱스 생성 전 기존 대소문자 중복을 선정리(V210 과 같은 방식) — 가장 오래된(id 최소) 행만 원래 이름을 유지하고 나머지는
-- 구분 접미사를 붙인다(삭제 아님 — 이슈에 붙은 사이클을 그대로 보존). VARCHAR(60) 을 넘지 않게 원래 이름 앞부분을 잘라 접미사 자리를 만든다.
-- V210 과 달리 접미사에 순번 대신 행 id 를 쓰고, 겹침이 없어질 때까지 되풀이한다 — 바꾼 이름이 이미 있는 이름(예: 누가 직접 지은
-- 「sprint (중복-2)」)이나 잘린 앞부분이 같은 다른 이름과 다시 겹쳐도 다음 회차에 그 행만 다시 바꾼다. 옛 정확 일치 제약을 먼저 지워
-- 바꾸는 도중 제약에 걸려 마이그레이션이 멈추지 않게 한다. 회차마다 겹친 묶음의 가장 오래된 행은 그대로라 반드시 줄어든다(안전 상한 20회).
ALTER TABLE cycle DROP CONSTRAINT cycle_project_id_name_key;

DO $$
DECLARE
  pass INT := 0;
  changed INT;
BEGIN
  LOOP
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, lower(name) ORDER BY id) AS rn FROM cycle
    )
    UPDATE cycle t
    SET name = left(t.name, 60 - length(' (중복-' || t.id || ')')) || ' (중복-' || t.id || ')'
    FROM ranked r
    WHERE t.id = r.id AND r.rn > 1;
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed = 0;
    pass := pass + 1;
    IF pass >= 20 THEN
      RAISE EXCEPTION 'WP-1393: 사이클 이름 대소문자 중복 정리가 20회 안에 끝나지 않았습니다';
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX uq_cycle_project_lower_name ON cycle (project_id, lower(name));
