// AI Pod 의 DinD 저장 공간 정리(WP-1581) — dind 사이드카가 있는 Pod 에 runner 가 함께 넣는 dind-gc 컨테이너가 돌리는 sh 스크립트.
// DinD 의 /var/lib/docker 는 emptyDir 이라 Pod 를 다시 만들 때만 비워진다. AI 가 이슈마다 남긴 이미지·볼륨·빌드 캐시가 쌓여
// sizeLimit 을 넘으면 kubelet 이 Pod 를 쫓아낸다(Evicted). 그 전에 같은 Pod 안에서 거둔다.
//
// 왜 임계값 기반인가: 시간마다 무조건 `image prune -a` 하면 막 받은 이미지도 지워(until 은 받은 시각이 아니라 이미지를 만든 시각 기준)
// Testcontainers 시작과 부딪히고 Docker Hub 에서 익명으로 다시 받는다. 그래서 사용량이 임계값을 넘을 때만,
// 다시 만들기 쉬운 것(멈춘 컨테이너 → 이름 없는 볼륨)을 먼저 지우고, 그래도 넘을 때만 빌드 캐시·이미지를 지운다.
// - 컨테이너는 만든 지 10분 지난 것만 — create 와 start 사이(Testcontainers·docker run)의 컨테이너를 지우지 않게.
// - 볼륨은 이름 없는 것만(Docker 23+ 기본) — 이름 붙은 데이터 볼륨(멈춘 개발 DB 등)은 AI 의 데이터라 남긴다.
// - 빌드 캐시·이미지 정리는 쿨다운(DIND_GC_IMAGE_COOLDOWN_SECONDS)에 한 번만 — 실행 중인 것만으로 임계값을 넘는 동안
//   매번 지우면 빌드가 늘 처음부터 돌고 테스트가 이미지를 거듭 다시 받는다.
// 쓰는 컨테이너에 붙은 볼륨·이미지는 prune 이 건드리지 않는다.
//
// 사용량은 kubelet 이 emptyDir 을 재는 방식처럼 저장 볼륨을 du 로 잰다(KiB). TERM 을 받으면 바로 끝난다 —
// sh 가 PID 1 이면 TERM 을 무시하므로 trap 을 걸고, sleep 을 백그라운드로 두고 wait 해야 trap 이 대기 중에도 바로 돈다.
// env: DOCKER_HOST(dind 소켓), DIND_GC_THRESHOLD_KIB(이 값 이상이면 정리), DIND_GC_INTERVAL_SECONDS(확인 간격),
//      DIND_GC_IMAGE_COOLDOWN_SECONDS(빌드 캐시·이미지 정리 최소 간격).
// du 가 아무것도 내지 못하면(권한·경로 문제) 정리가 조용히 꺼지므로 그때마다 로그를 남긴다.
export const DIND_GC_SCRIPT = `trap 'exit 0' TERM INT
used() { du -sk /dind-storage 2>/dev/null | cut -f1; }
over() { [ -n "$u" ] && [ "$u" -ge "$DIND_GC_THRESHOLD_KIB" ]; }
last_image_prune=""
while :; do
  u=$(used)
  [ -n "$u" ] || echo "[dind-gc] /dind-storage 사용량을 잴 수 없습니다 — 이번 확인은 건너뜁니다"
  if over; then
    echo "[dind-gc] 사용 \${u}KiB ≥ 임계 \${DIND_GC_THRESHOLD_KIB}KiB — 멈춘 컨테이너·이름 없는 볼륨을 지웁니다"
    docker container prune -f --filter until=10m
    docker volume prune -f
    u=$(used)
    if over; then
      now=$(date +%s)
      if [ -z "$last_image_prune" ] || [ $((now - last_image_prune)) -ge "$DIND_GC_IMAGE_COOLDOWN_SECONDS" ]; then
        echo "[dind-gc] 아직 \${u}KiB — 빌드 캐시·쓰지 않는 이미지도 지웁니다"
        docker builder prune -af
        docker image prune -af
        last_image_prune=$now
        u=$(used)
      else
        echo "[dind-gc] 아직 \${u}KiB — 빌드 캐시·이미지 정리는 쿨다운 중이라 건너뜁니다"
      fi
    fi
    echo "[dind-gc] 정리 뒤 \${u}KiB"
  fi
  sleep "$DIND_GC_INTERVAL_SECONDS" &
  wait $!
done
`;

/** 확인 간격(초) — kubelet 의 emptyDir 측정 주기(대개 1분 안팎)와 비슷하게 자주 보되, 큰 /var/lib/docker 를 du 로 훑는 부담은 작게. */
export const DIND_GC_INTERVAL_SECONDS = 300;

/** 빌드 캐시·이미지 정리 최소 간격(초) — 실행 중인 것만으로 임계값을 넘는 동안 거듭 지워 다시 만들거나 받게 하지 않게. */
export const DIND_GC_IMAGE_COOLDOWN_SECONDS = 3600;
