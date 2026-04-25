# DXF Entity Group Code 치트시트

DXF ASCII 포맷의 주요 엔티티별 group code. 자체 파서 구현 시 빠른 참조용. 공식 사양: Autodesk DXF Reference.

## 공통 코드

| code | 의미 |
|------|------|
| 0    | entity type (LINE, CIRCLE 등) |
| 5    | handle (16진 ID) |
| 8    | layer 이름 |
| 62   | 색 (ACI index, 음수면 layer-off) |
| 6    | linetype 이름 |
| 39   | thickness |
| 48   | linetype scale |
| 100  | subclass marker |

## LINE

| code | 의미 |
|------|------|
| 10/20/30 | 시작점 X/Y/Z |
| 11/21/31 | 끝점 X/Y/Z |

## CIRCLE

| code | 의미 |
|------|------|
| 10/20/30 | 중심 X/Y/Z |
| 40 | 반지름 |

## ARC

| code | 의미 |
|------|------|
| 10/20/30 | 중심 |
| 40 | 반지름 |
| 50 | 시작 각도 (도) |
| 51 | 끝 각도 (도) |

각도는 반시계방향, 0도가 +X.

## LWPOLYLINE

| code | 의미 |
|------|------|
| 90 | vertex 개수 |
| 70 | flags (1 = closed) |
| 10/20 | vertex X/Y (각 vertex마다 반복) |
| 42 | bulge (각 vertex의 호 곡률) |

## POLYLINE / VERTEX

`POLYLINE` 시작 후 여러 `VERTEX`가 따라오고 `SEQEND`로 종료. LWPOLYLINE에 비해 무거우나 3D polyline 등 더 많은 변형.

## TEXT

| code | 의미 |
|------|------|
| 1 | 문자열 |
| 10/20 | 삽입점 |
| 40 | 글자 높이 |
| 50 | 회전(도) |
| 7 | 스타일 |
| 72/73 | 정렬 (h/v) |

## MTEXT

| code | 의미 |
|------|------|
| 1, 3 | 텍스트 (3은 250자 초과분 chunk) |
| 10/20 | 삽입점 |
| 40 | 라인 높이 |
| 41 | 박스 너비 |
| 50 | 회전 |
| 71 | 첨부 위치 |

내부에 inline 코드(`\P` newline, `\f` font 등)가 있어 파싱 주의.

## INSERT (블록 인서트)

| code | 의미 |
|------|------|
| 2 | 블록 이름 |
| 10/20/30 | 삽입점 |
| 41/42/43 | 스케일 X/Y/Z |
| 50 | 회전 |
| 70/71 | row/col 반복 |

블록 정의는 `BLOCKS` 섹션의 `BLOCK ... ENDBLK` 안에. INSERT는 정의를 참조해 transform 적용 후 그린다 → InstancedMesh 후보.

## HATCH

| code | 의미 |
|------|------|
| 2 | 패턴 이름 |
| 70 | solid 여부 (1=solid) |
| 91 | 경계 path 개수 |
| 92, 93, 72/73, 10/20, ... | 경계 path 정의 (loop) |

가장 복잡. 페이즈 후반에 추가.

## DIMENSION / LEADER

치수·지시선. 본문은 INSERT처럼 anonymous block 참조. 페이즈 후반.

## 색 (ACI Index)

ACI 0~255, 일부 고정:
- 0 = ByBlock
- 256 = ByLayer
- 1=red, 2=yellow, 3=green, 4=cyan, 5=blue, 6=magenta, 7=white/black(배경 따라)
- 8~9 = grey
- 10~249 = palette
- 250~255 = grey

ACI → RGB 매핑 테이블은 외부 자료(또는 LibreCAD 소스) 참조해 한 번 만들어두면 재사용.

## 단위 (HEADER 섹션)

| 변수 | 의미 |
|------|------|
| `$INSUNITS` | 0=무단위, 1=inch, 2=ft, 4=mm, 5=cm, 6=m |
| `$EXTMIN`, `$EXTMAX` | 도면 bounding box |
| `$LIMMIN`, `$LIMMAX` | 도면 한계 |

`$INSUNITS`로 측정 결과 단위 표시 분기.
