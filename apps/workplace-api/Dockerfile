# === Stage 1: Build ===
# 빌드 스테이지는 최종 이미지에 남지 않으므로 stock 이미지를 쓴다 — 하드닝은
# 출하되는 런타임 스테이지에만 적용한다 (정책 A: 런타임만 DHI).
FROM --platform=$BUILDPLATFORM eclipse-temurin:21-jdk AS build

ENV GRADLE_OPTS="-Xmx512m"
WORKDIR /app

# 의존성 캐싱을 위해 wrapper와 빌드 파일 먼저 복사
COPY gradle/ gradle/
COPY gradlew build.gradle.kts settings.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon || true

COPY src/ src/

# 코드젠 결과(src/main/generated)는 커밋되어 있으므로 generateJooq(DB 필요) 제외.
RUN ./gradlew bootJar -x test -x generateJooq --no-daemon

# === Stage 2: Runtime ===
# DHI 하드닝 런타임(distroless) — shell/패키지매니저 없음, nonroot(UID 65532) 기본.
# curl 등 진단 도구는 없다(healthcheck 는 compose 에서 제거). 현장 진단은 Docker Debug 사이드카로 수행.
FROM dhi.io/eclipse-temurin:21-debian13

WORKDIR /app
# distroless라 RUN chown 불가 → COPY 시 nonroot(65532) 소유로 복사
COPY --from=build --chown=65532:65532 /app/build/libs/*.jar app.jar
USER 65532

EXPOSE 9090

ENTRYPOINT ["java", "-jar", "app.jar"]
