# PhotoFrame — 구조와 마이그레이션 계획

## 현재 구조 (v3, 단일 HTML)

소스는 [index.html](../index.html) 하나다. 바닐라 JS + Canvas 2D, 의존성 0개. `legacy/filmframe.html`은 인수인계 시점의 v3 원본 보존본으로 수정하지 않는다.

```
index.html
├─ <style>            암실 라이트테이블 UI (docs/DESIGN.md)
├─ <body>              좌: 뷰포트+필름스트립 / 우: 설정 레일
└─ <script>
   ├─ 상수             C(캔버스 색), SEED(기본 장비/프리셋)
   ├─ store            localStorage 래퍼 (실패 시 메모리 폴백)
   ├─ state            shots[], current, style, tone, dirHandle
   ├─ render(img,o)    프레임 합성 — 스타일별 분기 (핵심 로직)
   ├─ downscale        긴 변 리사이즈
   ├─ opts/filename    설정 읽기, 내보내기 파일명 규칙
   ├─ 뷰포트           줌/팬 (transform 기반)
   ├─ refresh          rAF 디바운스 미리보기
   ├─ drawStrip        필름 스트립 (선택/삭제/DnD 정렬)
   ├─ addFiles         파일 로드
   ├─ 프리셋           저장/적용/삭제, datalist 채움
   └─ 내보내기         File System Access API + 다운로드 폴백
```

### 데이터 흐름

```
파일 드롭 → addFiles → state.shots[{img,url,name}]
              ├ readExif (JPEG) → 카메라/렌즈/날짜 자동 입력
                          ↓
입력 변경 → opts() ──→ render(img, opts) → 미리보기 캔버스
                          ↓
내보내기 → render → downscale → toBlob → dirHandle 저장 or 다운로드
```

미리보기와 내보내기가 **같은 `render()` 함수**를 쓴다 — 보이는 것과 저장되는 것이 항상 일치한다. 이 성질은 마이그레이션 후에도 유지한다.

### 저장되는 것 / 되지 않는 것

- localStorage: 장비 팔레트(`frame.gear`)와 입력·표시·내보내기 설정(`frame.settings`). 접근 실패(iframe 등) 시 메모리 폴백.
- 사진: 절대 어디에도 저장·전송하지 않는다. objectURL은 썸네일 표시용이고 삭제 시 revoke.

## 알려진 한계

- **색 프로파일**: Canvas는 임베디드 ICC 프로파일(Adobe RGB 등)을 무시한다. `createImageBitmap`+`colorSpaceConversion`으로도 완전 해결이 어려워 sRGB 스캔본 사용을 권장하는 한계로 명시.
- **메모리**: 원본 디코드 이미지를 전부 유지한다. 롤 단위(36장) 고해상도 스캔에서는 부담 — 썸네일 축소본 분리가 개선 과제.
- **모바일 터치**: 핀치 줌 미구현 (pointer 이벤트 기반이라 확장 가능).

## 마이그레이션 계획 (2단계)

1. **Vite + TypeScript** 전환. `vite-plugin-singlefile`로 빌드 산출물이 단일 HTML이 되게 유지 — "파일 하나 받아서 더블클릭으로 연다"는 사용 방식을 보존한다.
2. **렌더링 엔진 분리** — `src/core/render.ts`: DOM 의존 없는 순수 함수 `render(source, options): Canvas`. 스타일별 렌더러 분리, 타입은 `src/core/types.ts`.
3. **UI 레이어 분리** — viewport / filmstrip / settings-panel / export.
4. **테스트** — Vitest. 순수 로직(레이아웃 수치, 메타 텍스트 조합)은 단위 테스트, 렌더 결과는 픽셀 해시 스냅샷.
5. 완료 후 `legacy/`는 참조용으로만 유지.

## 의존성 정책

새 의존성은 최소화한다. 추가할 때마다 이 목록에 이유를 한 줄 남긴다.

| 의존성 | 이유 |
|---|---|
| (없음) | — |
