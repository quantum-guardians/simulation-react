# MR2S Backend 레퍼런스 문서

> 이 문서는 mr2s-backend 프로젝트를 다른 저장소/Claude 세션에서 참조하기 위한 자체 완결형 문서입니다.
> 프론트엔드 등 다른 프로젝트의 `CLAUDE.md`나 컨텍스트 파일로 그대로 복사해서 사용할 수 있습니다.

## 1. 프로젝트 개요

- **이름**: MR2S Backend (Quantum Hackathon API)
- **목적**: 무방향 그래프의 간선(edge)에 방향을 부여하여, 모든 정점 쌍 간 최단 경로 합(APSP, All-Pairs Shortest Path)을 최소화하는 방향 그래프를 찾는 최적화 API 서버
- **핵심 접근법**: 그래프 방향 최적화 문제를 QUBO(Binary Polynomial)로 변환한 뒤 D-Wave Ocean SDK(dimod)의 솔버로 해결. Simulated Annealing 기반(raw-sa), 완전 탐색(brute-force) 방식도 별도 제공
- **기술 스택**: Python 3.11/3.12, FastAPI, Pydantic v2, uvicorn, networkx, dwave-ocean-sdk (dimod, minorminer, dwave_networkx)
- **배포**: Docker (`python main.py`로 포트 8000 실행), GitHub Actions CI (`.github/workflows/docker-ci.yml`)

## 2. 실행 방법

```bash
# 로컬
pip install -r requirements.txt
python main.py            # http://0.0.0.0:8000

# Docker
docker build -t mr2s-backend .
docker run -p 8000:8000 mr2s-backend
```

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 3. CORS 허용 오리진

프론트엔드는 아래 오리진에서만 브라우저 요청이 허용됩니다 (`main.py`):

- `https://quantum-guardians.github.io`
- `https://mr2s.vercel.app`
- `https://qi4uinpnu.vercel.app`

허용 메서드: GET, POST, PUT, DELETE, OPTIONS / 허용 헤더: `Content-Type`, `Authorization` / credentials 허용

로컬 개발 오리진(`http://localhost:*`)은 현재 목록에 없으므로, 로컬 프론트에서 직접 호출 시 CORS 오류가 발생할 수 있습니다.

## 4. API 명세

Base URL(로컬): `http://localhost:8000`, Content-Type: `application/json`

### 4.1 헬스 체크

#### `GET /`

```json
{ "message": "Quantum Hackathon API" }
```

### 4.2 V1 API (권장) — 가중치 그래프 입력

#### 공통 요청 스키마 (`WeightedRequestDto`)

```json
{
  "edges": [
    { "vertices": [1, 2], "weight": 1 },
    { "vertices": [2, 3], "weight": 2 },
    { "vertices": [3, 1], "weight": 1 }
  ]
}
```

- `edges[].vertices`: 길이 2의 정수 배열 (무방향 간선의 양 끝 정점). 서버 내부에서 오름차순 정렬됨
- `edges[].weight`: 정수 가중치
- 정점 목록은 별도로 받지 않고 간선에서 자동 추출됨

#### 공통 응답 스키마 (`ResponseDto`)

```json
{
  "edges": [
    { "_from": 1, "to": 2 },
    { "_from": 2, "to": 3 }
  ],
  "optimized_graph_score": 123.0,
  "bidirectional_graph_score": 140.0
}
```

- `edges`: 방향이 결정된 간선 목록 (`_from` → `to`)
- `optimized_graph_score`: 최적화된 방향 그래프의 APSP 합 (강연결이 아니면 `-1`)
- `bidirectional_graph_score`: 같은 간선을 무방향으로 봤을 때의 APSP 합 (비교 기준값)

#### 오류 응답 (V1 공통)

| 상태 | 본문 | 의미 |
|---|---|---|
| 400 | `{"detail": "Invalid input: ..."}` | 입력 검증 실패 (`ValueError`) |
| 408 | `{"detail": "Optimization timed out after 10 seconds"}` | 최적화가 10초 제한 초과 |
| 500 | `{"detail": "Optimization failed: ..."}` | 기타 서버 오류 |

#### 엔드포인트 목록

| 엔드포인트 | 알고리즘 | 비고 |
|---|---|---|
| `POST /api/v1/mr2s` | 다항식(QUBO) 기반 최적화 파이프라인 (FlowConservation + MinimizeSumOfApsp, 2-hop/3-hop 가중치 1) | 메인 알고리즘 |
| `POST /api/v1/raw-sa` | NaotoService — Simulated Annealing 기반 | |
| `POST /api/v1/brute-force` | 모든 방향 조합 완전 탐색 | 간선 수에 따라 2^E 지수적 증가, 작은 그래프 전용 |
| `POST /api/v1/mr2s/estimate` | 큐빗 수 추정 (최적화 실행 없음) | 아래 4.3 참조 |

세 최적화 엔드포인트 모두 요청/응답 스키마가 동일하며, **10초 타임아웃**이 자식 프로세스 강제 종료 방식으로 적용됩니다 (`utils/timeout.py`, `TIME_OUT = 10`).

### 4.3 `POST /api/v1/mr2s/estimate` — 물리 큐빗 수 추정

MR2S 파이프라인이 생성하는 BQM(Binary Quadratic Model)을 D-Wave Pegasus P16 토폴로지에 minorminer로 임베딩했을 때 필요한 물리 큐빗 수를 추정합니다. 최적화는 실행하지 않습니다.

- 요청: `WeightedRequestDto` (4.2와 동일)
- 응답 (`EstimateResponseDto`):

```json
{
  "num_logical_variables": 12,
  "num_quadratic_couplings": 30,
  "num_physical_qubits": 45,
  "max_chain_length": 5,
  "error": null
}
```

- `num_logical_variables`: BQM 변수(논리 큐빗) 수
- `num_quadratic_couplings`: 2차 상호작용(coupling) 수
- `num_physical_qubits`: 임베딩 후 총 물리 큐빗 수
- `max_chain_length`: 임베딩 체인 최대 길이
- 임베딩 실패 시: `num_physical_qubits`와 `max_chain_length`가 `-1`, `error`에 메시지 포함
- 오류: 400 (`Invalid input`, 빈 그래프 포함), 500 (`Estimation failed`)
- 이 엔드포인트에는 타임아웃이 적용되지 않음 (임베딩 계산이 오래 걸릴 수 있음)

### 4.4 레거시 API — 비가중치 그래프 입력

#### 요청 스키마 (`RequestDto`, Pydantic)

```json
{
  "vertices": [1, 2, 3],
  "edges": [[1, 2], [2, 3], [1, 3]],
  "num_edges": 3
}
```

- `vertices`: 정점 목록 (비어 있으면 간선에서 추출)
- `edges`: `[u, v]` 형태 간선 목록
- `num_edges`: 선택값 (0 이상), 실험용 필드

| 엔드포인트 | 알고리즘 | 비고 |
|---|---|---|
| `POST /optimize/small-world` | V1 mr2s와 동일 파이프라인 (가중치 1 고정) | 타임아웃 없음 |
| `POST /optimize/naoto` | `optimize_edge_orientations` (naoto 방식) | 타임아웃 없음 |

응답은 V1과 동일한 `ResponseDto`. 오류는 400/500만 존재 (408 없음).

### 4.5 cURL 예시

```bash
# V1 MR2S 최적화
curl -X POST "http://localhost:8000/api/v1/mr2s" \
  -H "Content-Type: application/json" \
  -d '{"edges": [{"vertices": [1,2], "weight": 1}, {"vertices": [2,3], "weight": 2}, {"vertices": [3,1], "weight": 1}]}'

# 큐빗 수 추정
curl -X POST "http://localhost:8000/api/v1/mr2s/estimate" \
  -H "Content-Type: application/json" \
  -d '{"edges": [{"vertices": [1,2], "weight": 1}, {"vertices": [2,3], "weight": 1}]}'
```

## 5. 프로젝트 구조

```
mr2s-backend/
├── main.py                        # FastAPI 앱 진입점, CORS 설정, 라우터 등록
├── router/
│   ├── optimization_router.py     # 레거시: /optimize/small-world, /optimize/naoto
│   └── optimization_v1_router.py  # V1: /api/v1/mr2s, /api/v1/raw-sa, /api/v1/brute-force, /api/v1/mr2s/estimate
├── dto/
│   ├── request_dto.py             # RequestDto (레거시, Pydantic BaseModel)
│   ├── request_v1_dto.py          # WeightedRequestDto, WeightedEdgeDto (dataclass) → to_domain()
│   ├── response_dto.py            # ResponseDto, EdgeDto + from_tuples() (점수 계산 포함)
│   └── estimate_response_dto.py   # EstimateResponseDto
├── domain/
│   └── weighted_graph.py          # WeightedGraph, WeightedEdge, AdjEntry (핵심 도메인 모델)
├── service/
│   ├── optimization_service.py    # 추상 클래스: OptimizationService, WeightedOptimizationService, ProxyOptimizationService
│   ├── polynomial_optimization_service.py  # QUBO 파이프라인 (optimize, get_bqm)
│   ├── polynomial_generator.py             # PolynomialGenerator 추상 클래스
│   ├── flow_conservation_polynomial_generator.py   # 흐름 보존 제약 다항식
│   ├── minimize_sum_of_apsp_polynomial_generator.py # n-hop APSP 최소화 다항식 (SmallWorldSpec, NHop)
│   ├── naoto_service.py           # SA 기반 최적화 (optimize_edge_orientations 등)
│   ├── bruteforce_service.py      # 완전 탐색
│   └── graph_analyzer.py          # calculate_total_apsp_distance (networkx 기반 채점)
└── utils/
    ├── timeout.py                 # run_with_timeout: 자식 프로세스 실행 + 10초 제한 → 408
    ├── qubo_utils.py              # add_polys, multiply_polys, build_bqm, solve_binary_polynomial 등
    ├── embedding_utils.py         # estimate_required_qubits (Pegasus P16 + minorminer)
    └── graph_utils.py             # extract_vertices 등
```

## 6. 아키텍처 및 동작 흐름

### V1 최적화 요청 흐름

```
WeightedRequestDto → to_domain() → WeightedGraph
  → run_with_timeout(자식 프로세스, 10초 제한)
    → service.optimize(graph) → list[(from, to)]
  → ResponseDto.from_tuples()  # networkx로 방향/무방향 APSP 점수 계산
```

### MR2S(QUBO) 파이프라인 상세

1. 각 간선 `(u, v)`(u < v)에 이진 변수 `e_u_v` 할당 — `0`이면 u→v, `1`이면 v→u
2. `PolynomialGenerator` 목록이 각각 BinaryPolynomial 항을 생성해 합산:
   - `FlowConservationPolynomialGenerator`: 흐름 보존 제약 (각 정점의 진입/진출 균형)
   - `MinimizeSumOfApspPolynomialGenerator`: n-hop 경로 항 (현재 설정: 2-hop weight 1, 3-hop weight 1)
3. dimod 솔버로 샘플링 → 여러 샘플 중 실제 APSP 점수가 가장 낮은(강연결인) 해 선택
4. `get_bqm(graph)`는 같은 다항식을 BQM으로만 변환 (estimate 엔드포인트용)

### 채점 함수 (`calculate_total_apsp_distance`)

- networkx로 모든 정점 쌍 최단 경로 길이 합을 계산
- 방향 그래프인데 강연결이 아니거나, 무방향인데 연결이 아니면 **`-1` 반환** — 프론트에서는 `-1`을 "연결 불가"로 처리해야 함

### 타임아웃 (`utils/timeout.py`)

- 최적화는 별도 프로세스에서 실행 (POSIX는 fork, Windows는 spawn)
- 10초 초과 시 프로세스 강제 종료 후 `HTTPException(408)` 발생
- 프론트엔드는 408 응답을 "시간 초과, 그래프를 줄여서 재시도" UX로 처리 권장

## 7. 프론트엔드 연동 시 주의사항

1. **V1 API 사용 권장** — 레거시(`/optimize/*`)는 타임아웃이 없어 큰 입력에서 서버가 오래 붙잡힐 수 있음
2. **응답 필드명이 `_from`** — JS에서 `edge._from`으로 접근 (`from`은 예약어 회피 목적)
3. **점수 `-1`은 오류가 아니라 "연결 불가"** 의미
4. **HTTP 408 처리 필수** (V1 최적화 3종)
5. **brute-force는 작은 그래프 전용** — 간선 수 E에 대해 2^E 조합 탐색
6. **estimate는 계산만, 최적화 없음** — 큐빗 추정 UI용
7. 새 프론트 도메인 추가 시 `main.py`의 CORS `allow_origins`에 등록 필요

## 8. 관련 문서 (저장소 내)

- `docs/api_spec.md` — API 명세 (estimate 엔드포인트 추가 전 버전)
- `docs/optimization_services.md` — 최적화 서비스 설명
- `docs/polynomial_generator_system.md` — 다항식 생성기 시스템 설명
