---
name: viewer-engineering
description: drawing-mgmt 자체 DWG 뷰어 구현 가이드. three.js + DXF 자체 파서로 도면을 브라우저에서 렌더하고, 측정·팬·줌·레이어 토글·성능 튜닝을 다룬다. viewer-engineer 에이전트가 DwgViewer 작업을 시작하기 전 반드시 읽는다. .dxf/.dwg 처리, three.js Scene 구성, OrthographicCamera, BufferGeometry 최적화, LibreDWG subprocess 격리 같은 토픽이 등장하면 이 스킬을 사용한다.
---

# DWG 뷰어 엔지니어링 가이드

drawing-mgmt의 자체 뷰어는 외부 SDK를 쓰지 않는다. **LibreDWG(GPL, 서버 subprocess) → DXF → 자체 파서 → three.js 렌더**. 이 문서는 그 구현 원칙과 실패 패턴을 정리한다.

## 0. 라이선스 격리 (가장 먼저)

**LibreDWG는 GPL이다. 절대 npm 패키지로 import하지 않는다.**

올바른 사용:
```ts
// 서버 코드 (Node.js, Next.js Route Handler 또는 BullMQ 워커)
import { spawn } from 'child_process';
const proc = spawn(process.env.LIBREDWG_PATH ?? 'dwg2dxf', [input, '-o', output]);
```

금지:
- `node-libredwg`, `libredwg-js` 같은 JS 바인딩 import
- 클라이언트 번들에 LibreDWG가 들어가는 모든 형태
- WebAssembly로 빌드해 브라우저에서 직접 실행

이유: arm's length subprocess는 GPL 전염을 차단(별도 프로세스, IPC 경계). JS 바인딩 import는 "linking"으로 간주되어 웹 앱 코드 전체가 GPL이 된다.

## 1. 전체 데이터 흐름

```
사용자 업로드 .dwg
   ↓ (BullMQ 잡)
LibreDWG subprocess (dwg2dxf) → .dxf
   ↓ 스토리지 저장
브라우저: fetch(.dxf as text)
   ↓
Web Worker: DXF 파서 → 엔티티 트리 (JSON)
   ↓ postMessage
Main thread: 엔티티 트리 → three.js Scene (BufferGeometry)
   ↓
OrthographicCamera + OrbitControls(2D 모드)로 렌더
```

이 파이프라인의 어느 단계도 메인 스레드를 5ms 이상 점유하면 안 된다 (특히 큰 파일).

## 2. DXF 파서 설계

### 2.1 입력
ASCII DXF (DXF text format). 바이너리 DXF는 LibreDWG 변환 시 옵션으로 ASCII 강제.

### 2.2 구조
DXF는 group code + value 페어의 평문 시퀀스. SECTION 단위로 구분:
- `HEADER` — 단위·extents 등 메타
- `TABLES` — LAYER, LTYPE 등 정의
- `BLOCKS` — 재사용 블록 정의
- `ENTITIES` — 실제 도면 엔티티
- `OBJECTS` — 추가 객체

### 2.3 우선 지원 엔티티 (페이즈 1)
- `LINE` — 두 점
- `CIRCLE` — 중심·반지름
- `ARC` — 중심·반지름·시작각·끝각
- `LWPOLYLINE` / `POLYLINE` — 점 배열, 닫힘 여부
- `TEXT` / `MTEXT` — 위치·크기·내용 (페이즈 2)
- `INSERT` — 블록 인스턴스 (페이즈 3)
- `HATCH` — 채우기 (페이즈 3)

미지원 엔티티는 `console.warn`으로 알리고 넘어간다 — 전체 렌더가 멈추면 안 된다.

### 2.4 출력 (엔티티 트리)
```ts
type Entity =
  | { kind: 'line'; layer: string; color: number; p1: V2; p2: V2 }
  | { kind: 'arc'; layer: string; center: V2; radius: number; startAngle: number; endAngle: number }
  | { kind: 'circle'; layer: string; center: V2; radius: number }
  | { kind: 'polyline'; layer: string; points: V2[]; closed: boolean }
  | { kind: 'text'; layer: string; position: V2; height: number; content: string; rotation: number }
  | { kind: 'insert'; layer: string; blockName: string; position: V2; scale: V2; rotation: number };
```

색은 ACI(AutoCAD Color Index) 정수 → RGB 매핑 테이블로.

### 2.5 Web Worker 분리
파서는 그래픽 의존성 없는 순수 함수. 파일 크기가 작아도 메인 스레드를 막지 않게 워커에서 실행. `Comlink` 같은 헬퍼는 선택. 표준 `postMessage`로도 충분.

## 3. three.js Scene 구성

### 3.1 카메라
- **OrthographicCamera** 디폴트 (2D 도면)
  - left/right/top/bottom을 viewport 비율 + 줌 레벨로 계산
  - near/far는 ±10000 정도 여유
- 3D 뷰가 명시적으로 필요하면 PerspectiveCamera로 토글

### 3.2 좌표계
도면 모델 좌표(mm 또는 inch) → three.js world 좌표를 1:1로. 카메라가 viewport 변환을 담당. 별도 스케일 변환을 추가하면 측정·인터랙션이 꼬인다.

### 3.3 렌더 객체 매핑
- `LINE`, `LWPOLYLINE` → `THREE.LineSegments` 또는 `THREE.Line` + `BufferGeometry`. **여러 라인을 하나의 BufferGeometry에 모아라.** 1엔티티 = 1geometry는 큰 도면에서 죽는다.
- `CIRCLE`, `ARC` → 각도 분할 → 라인 세그먼트 (분할 수는 줌 레벨에 따라 LOD 가능)
- `INSERT` (블록 인서트) → 같은 블록이 여러 번 등장하면 `InstancedMesh`
- `TEXT` → Canvas Texture로 sprite, 또는 SDF 폰트(troika-three-text 등). 양이 많으면 LOD로 멀리선 점/생략

### 3.4 레이어
DXF의 layer = 그룹. three.js에서는 각 레이어를 `THREE.Group`으로 두고 `visible` 토글. 레이어별 색·선두께는 머티리얼에 반영.

### 3.5 라인 두께
WebGL은 기본 line width 1px만. 두꺼운 라인은:
- `THREE.Line2` (LineMaterial, three.js examples)
- 또는 자체 quad mesh

처음엔 1px로 시작하고 사용자 요구 시 Line2.

## 4. 인터랙션

### 4.1 팬/줌
- 휠 → 줌 (마우스 위치 기준)
- 드래그 → 팬
- `OrbitControls`(2D 모드, enableRotate=false)로 충분, 아니면 자체 구현

### 4.2 측정
- 두 점 거리: 클릭 두 번 → world 좌표 변환 → 거리 표시 (도면 단위 mm/inch)
- 좌표 변환 헬퍼는 `screenToModel(event) → V2` 한 곳에 둔다

### 4.3 호버/선택
- `Raycaster`로 엔티티 hit test
- 라인은 두께가 얇아 raycaster가 잘 안 잡히므로 별도 BVH 또는 거리 임계값 사용

### 4.4 키보드
- `+`/`-` 줌, 화살표 팬, `F` fit, `1-9` 레이어 토글 등 (디자이너가 정의)

## 5. 성능 함정

| 함정 | 증상 | 해결 |
|------|------|------|
| 1엔티티 1geometry | 10만 라인에 frame drop, GC 폭주 | LineSegments + 단일 BufferGeometry로 합치기 |
| 매 프레임 새 Vector3 | GC pause | 재사용 풀 또는 number 배열 직접 |
| 텍스트 텍스처 폭증 | VRAM 폭발 | SDF 폰트 또는 LOD |
| `dispose()` 누락 | 메모리 누수 (페이지 이탈 시) | 컴포넌트 unmount에서 geometry/material/renderer dispose |
| `useFrame`에서 무거운 계산 | 60fps 미달 | requestIdleCallback 또는 워커로 |
| 과도한 raycast | 클릭마다 전체 순회 | BVH (three-mesh-bvh) |

## 6. React 통합

`<DwgViewer src=".dxf URL" onMeasure={...} layers={...} />` 같은 안정적 props.

내부:
- `<canvas>` ref + `useEffect`로 `WebGLRenderer` 1회 생성
- `src` 변경 시 fetch → worker → scene rebuild
- unmount에서 `renderer.dispose()`, scene traverse + dispose
- `@react-three/fiber`는 선택지지만 본 프로젝트는 직접 three.js 권장 (컨트롤 정밀도)

## 7. 테스트

샘플 .dxf을 `apps/web/scripts/__fixtures__/`에 두고:
- 작은 파일 (라인 수십개) — 기본 동작
- 중간 (블록 인서트 다수) — instancing 동작
- 큰 파일 (10만 엔티티 이상) — 성능 회귀 감지

`docs/source/`에 실제 사례 .dwg가 있으면 변환해서 활용.

## 8. 변경 이력 — viewer_spec.md

뷰어 작업의 모든 변경은 `_workspace/viewer_spec.md`에 기록:
- 외부 props 인터페이스 (변경 이력 포함)
- 지원 엔티티 목록 (페이즈)
- 알려진 한계
- 성능 벤치 (큰 파일 fps)

frontend가 `<DwgViewer />`를 임베드할 때 이 문서가 진실이다.

## 참고 파일

- 추가 자료: `references/dxf-entity-codes.md` (DXF group code 치트시트, 작성 예정)
- 변환 파이프라인 코드: `apps/web/lib/libredwg-converter.ts` (backend 책임 영역)
- 뷰어 컴포넌트: `apps/web/components/DwgViewer/`
