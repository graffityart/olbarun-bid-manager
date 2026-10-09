# 올바른 입찰관리 (개인용)

Next.js + Vercel + Neon Postgres 기반 네이버 파워링크 입찰 관리 도구입니다.

## 현재 지원
키워드 동기화, 목표 순위별 평균 입찰가 조회, 최소/최대 입찰 한도, 변경 미리보기, 선택 키워드 수동 적용, 변경 이력, CSV 내보내기.
샘플 데이터는 실제 네이버 데이터가 아닙니다. 실시간 순위 추적과 무인 자동입찰은 구현되지 않았습니다.

## 설치 및 배포
1. 비공개 GitHub 저장소에 이 폴더의 내용을 업로드합니다.
2. Vercel에서 저장소를 Import합니다. Framework Preset은 Next.js입니다.
3. Neon에 전용 DB를 생성합니다. `.env.example`의 환경변수를 Vercel의 Production/Preview에 설정합니다.
4. `APP_PASSWORD`는 16자 이상으로 설정합니다. 설정되지 않으면 접근이 차단됩니다.
5. 직접 연결 문자열을 `DATABASE_URL_UNPOOLED`로 설정하고 `npm run db:migrate`를 한 번 실행합니다. 기존 사이트 DB를 쓰지 않는 것이 권장됩니다.
6. `npm run build` 후 배포합니다. DB 마이그레이션은 빌드 과정에서 자동 실행되지 않습니다.
7. 로그인 후 네이버 연결 → 실제 키워드 동기화를 실행합니다. 실제 적용 전 소수 키워드로 검증합니다.

`NAVER_CUSTOMER_ID`는 Customer ID, `NAVER_API_KEY`는 액세스 라이선스, `NAVER_SECRET_KEY`는 비밀키입니다. 키와 비밀번호를 GitHub에 올리지 마세요.

## 검증
`npm run check`, `npm test`, `npm run build`
실제 네이버 API 검증은 광고계정 연결 후 필요합니다. 평균 입찰가는 순위를 보장하지 않습니다.
추가된 오토다비드 참고 화면의 실행 진행률/실시간 현재 순위는 검증된 순위 데이터와 작업 실행기가 연결되기 전에는 표시하지 않습니다.
Vercel Hobby에서 분 단위 상시 작업을 전제로 하지 않습니다. 무인 입찰 기능을 추가하려면 별도 실행 방식 검증이 필요합니다.
