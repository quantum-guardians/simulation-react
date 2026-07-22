# mr2s-module API 레퍼런스

이 문서는 `mr2s_module`을 외부 프로젝트(또는 다른 Claude 세션)에서 라이브러리로 사용할 때 필요한
공개 API를 정리한 것입니다. 모든 공개 심볼은 최상위 패키지 `mr2s_module`에서 바로 import할 수 있습니다.

- **문제 도메인**: MR2S 간선 방향 결정(edge orientation) 문제 — 무방향 (평면)그래프의 모든 간선에
  방향을 부여하여, 강연결성(strong connectivity)을 유지하면서 전쌍 최단경로 합(APSP sum)과
  흐름 불균형(flow score)을 최소화하는 방향 조합을 찾는다.
- **요구 환경**: Python 3.11+
- **주요 의존성**: `dwave-ocean-sdk`(dimod, dwave-system), `networkx`, `numpy`, `minorminer`

## 설치

```bash
pip install -e .          # 저장소 루트에서 (editable)
pip install -e ".[test]"  # 테스트 의존성 포함
```

## 빠른 시작

```python
from mr2s_module import Edge, Graph, create_sa_solver

# 무방향 그래프 정의 (directed=False → 솔버가 방향을 결정할 대상)
graph = Graph(edges=[
    Edge(0, 1, weight=1, directed=False),
    Edge(1, 2, weight=1, directed=False),
    Edge(2, 3, weight=1, directed=False),
    Edge(3, 0, weight=1, directed=False),
])

solver = create_sa_solver()
solution = solver.run(graph)

print(solution.edges)   # 방향이 결정된 간선 집합: {(tail, head), ...}
print(solution.score)   # Score(apsp_sum=..., strong_connect_rate=..., flow_score=..., sample_score=...)
```

---

## 1. 도메인 모델 (`mr2s_module.domain`)

### `Edge`

```python
Edge(vertex1: int, vertex2: int, weight: int, directed: bool)
```

| 속성/메서드 | 설명 |
|---|---|
| `id: frozenset[int]` | `{vertex1, vertex2}` — 그래프 내 간선 키 |
| `vertices: tuple[int, int]` | `directed=True`면 `(tail, head)`, 아니면 정렬된 끝점 |
| `weight: int`, `directed: bool` | 가중치 / 방향 확정 여부 |
| `endpoints() -> tuple[int, int]` | 무방향 정렬된 `(u, v)` |
| `other_vertex(vertex: int) -> int` | 반대쪽 정점 |
| `to_key() -> str` | QUBO 변수명 `"e_{u}_{v}"` |
| `flip() -> Edge` | 방향이 뒤집힌 새 Edge |

### `Graph`

```python
Graph(edges: dict[frozenset[int], Edge] | Iterable[Edge] = {})
```

- 생성자에 `Edge` 리스트를 넘기면 자동으로 `{edge.id: edge}` dict로 변환된다.
- `get_vertices() -> set[int]` — 전체 정점 집합
- `get_adjacency_dict() -> dict[int, list[AdjEntry]]` — 인접 리스트 (`AdjEntry(vertex, weight, directed)`)
- `define_edge_direction(predefined_edges: Iterable[Edge])` — directed 간선으로 기존 간선을 덮어씀
  (**주의: 그래프를 in-place 변경**)
- `is_empty() -> bool`

### `Solution`

솔버 `run()`의 반환 타입.

```python
@dataclass
class Solution:
    edges: set[tuple[int, int]]   # 방향 결정 결과: (tail, head) 쌍의 집합
    graph: Graph                  # 입력 그래프
    sample_set: dimod.SampleSet   # 샘플링 원본 (SA/QA 결과)
    score: Optional[Score]        # 평가 결과 (솔버가 채움)
```

### `Score`

```python
@dataclass
class Score:
    apsp_sum: float             # 전쌍 최단경로 합. 강연결이 아니면 inf
    strong_connect_rate: float  # 샘플 중 강연결인 비율 [0, 1]
    flow_score: float           # 정점별 (in-weight − out-weight)² 합
    sample_score: float = 0.0   # sample_set 최저 에너지
```

낮을수록 좋음: `apsp_sum`, `flow_score`, `sample_score`. 높을수록 좋음: `strong_connect_rate`.

### `EmbeddingEstimate`

D-Wave 임베딩 추정 결과 (`estimate_required_qubits` / `QuboMR2SSolver.estimate_embedding` 반환).

```python
@dataclass
class EmbeddingEstimate:
    num_logical_variables: int
    num_quadratic_couplings: int
    num_physical_qubits: int
    max_chain_length: int
    embedding: dict[object, list[object]]  # 변수 → 물리 큐빗 체인

    has_physical_embedding: bool  # property
```

---

## 2. 팩토리 함수 — 권장 진입점 (`mr2s_module.solver.predefined`)

일반적인 사용에서는 솔버 클래스를 직접 조립하지 말고 아래 팩토리를 사용하면 된다.
모든 반환 솔버는 `run(graph: Graph) -> Solution` 인터페이스를 가진다.

| 함수 | 반환 | 설명 |
|---|---|---|
| `create_sa_solver(...)` | `SAMR2SSolver` | 시뮬레이티드 어닐링(직접 목적함수 기반). 로컬 실행 |
| `create_qubo_solver()` | `QuboMR2SSolver` | `create_qubo_sa_solver()`의 별칭 |
| `create_qubo_sa_solver()` | `QuboMR2SSolver` | QUBO 생성 후 SA 백엔드로 샘플링 |
| `create_qubo_qa_solver()` | `QuboMR2SSolver` | QUBO 생성 후 **D-Wave QA 하드웨어**로 샘플링 (자격증명 필요) |
| `create_dnc_sa_solver(max_vertices=100, ...)` | `DnCMr2sSolver` | 그래프를 `max_vertices` 이하로 분할 후 부분그래프를 SA로 해결 |
| `create_dnc_qubo_solver(target_graph=None)` | `DnCMr2sSolver` | `create_dnc_qubo_sa_solver`의 별칭 |
| `create_dnc_qubo_sa_solver(target_graph=None)` | `DnCMr2sSolver` | 분할 후 QUBO+SA로 해결 |
| `create_dnc_qubo_qa_solver(target_graph=None)` | `DnCMr2sSolver` | 분할 후 QUBO+QA로 해결 (자격증명 필요) |
| `create_robbin_solver(evaluator=Evaluator())` | `RobbinMR2SSolver` | Robbins 정리 기반 결정적 방향 부여 (베이스라인) |
| `create_ils_solver(max_iter=30, patience=5, is_relaxed=False, perturb_strength=2, evaluator=...)` | `IlsMR2SSolver` | Iterated Local Search 휴리스틱 |

`create_sa_solver` / `create_dnc_sa_solver`의 공통 키워드 인자:

```python
create_sa_solver(
    *,
    sweeps_per_temperature: int = 2,
    num_restarts: int = 4,
    random_seed: int | None = None,
    apsp_weight: float = 1.0,
    flow_weight: float = 1.0,
    disconnected_pair_penalty: float = 10.0,
) -> SAMR2SSolver
```

`target_graph`(DnC QUBO 계열): D-Wave 타깃 토폴로지 `networkx.Graph`. `None`이면 QA 백엔드에서
샘플러의 토폴로지를 자동 조회한다.

---

## 3. 솔버 클래스 (`mr2s_module.solver`)

세부 튜닝이 필요할 때 직접 조립한다. 모두 `Mr2sSolverProtocol`(`evaluator` 속성 +
`run(graph) -> Solution`)을 만족한다.

### `SAMR2SSolver`

목적함수(APSP + flow + 비연결 페널티)를 직접 계산하는 시뮬레이티드 어닐링 솔버.

```python
SAMR2SSolver(
    edge_orienter: EdgeOrientationProtocol | None = None,  # 사전 방향 고정용 (예: Tjoin)
    evaluator: EvaluatorProtocol = Evaluator(),
    *,
    apsp_weight: float = 1.0,
    flow_weight: float = 1.0,
    disconnected_pair_penalty: float = 10.0,
    initial_temperature: float = 5.0,
    final_temperature: float = 0.05,
    cooling_rate: float = 0.92,
    sweeps_per_temperature: int = 2,
    num_restarts: int = 4,
    random_seed: int | None = None,
    early_stop_patience: int | None = 3,
    min_temperature_steps: int = 5,
    early_stop_acceptance_rate: float = 0.01,
    min_objective_improvement: float = 0.0,
)
```

- `run(graph: Graph) -> Solution`
- 잘못된 하이퍼파라미터는 생성 시점에 `ValueError`.

### `QuboMR2SSolver`

간선당 이진 변수(`e_{u}_{v}`)로 QUBO를 구성해 샘플러에 위임하는 솔버.

```python
QuboMR2SSolver(
    edge_orienter: EdgeOrientationProtocol | None = None,
    qubo_solver: QuboSolverProtocol = QuboSolver.create_sa_solver(ranker=ApspSumRanker()),
    evaluator: EvaluatorProtocol = Evaluator(),
    poly_generators: list[PolyGeneratorProtocol] | None = None,
    # 기본: [FlowPolyGenerator(), NHopPolyGenerator(SmallWorldSpec(n_hops=[NHop(2,1), NHop(3,1)]))]
)
```

| 메서드 | 설명 |
|---|---|
| `run(graph) -> Solution` | BQM 생성 → 샘플링 → 평가 |
| `run_with_embedding(graph, embedding_estimate: EmbeddingEstimate) -> Solution` | 기존 물리 임베딩 재사용 (QA) |
| `build_bqm(graph) -> dimod.BinaryQuadraticModel` | QUBO만 생성 (직접 샘플링하고 싶을 때) |
| `estimate_embedding(graph) -> EmbeddingEstimate` | 필요 큐빗 수 사전 추정 |

### `DnCMr2sSolver`

분할 정복(Divide & Conquer): 그래프를 임베딩 가능한 크기의 부분그래프로 나눠 내부 솔버로 풀고 결합.

```python
DnCMr2sSolver(
    mr2s_solver: Mr2sSolverProtocol,                       # 부분그래프 솔버 (SA/QUBO 등)
    face_cycle: FaceClusterPartition = FaceClusterPartition(target_k=2, clusterer=KMeansFaceClusterer()),
    subgraph_processes: int | None = None,                 # 병렬 프로세스 수
    subgraph_start_method: ProcessStartMethod | None = None,
    target_graph: nx.Graph | None = None,                  # D-Wave 타깃 토폴로지
    graph_partition_strategy: DnCGraphPartitionStrategyProtocol | None = None,
)
```

- `run(graph: Graph) -> DnCSolution` — `DnCSolution`은 `Solution`의 서브클래스이며
  `sub_graphs: list[Graph]`, `embedding_estimates: list[EmbeddingEstimate]`, `partition_target_k` 등을 추가로 가진다.

### `RobbinMR2SSolver` / `IlsMR2SSolver` / `BaseEdgeOrientationSolver`

`EdgeOrientationProtocol` 구현을 감싸 독립형 솔버로 만드는 래퍼.

- `BaseEdgeOrientationSolver(edge_orienter, evaluator=Evaluator())` — 임의의 orientation 알고리즘용 부모 클래스.
  방향이 안 정해진 간선이 남으면 `ValueError`.
- `RobbinMR2SSolver(evaluator=...)` — 내부적으로 `Robbin()` 사용.
- `IlsMR2SSolver(max_iter=30, patience=5, is_relaxed=False, perturb_strength=2, evaluator=...)`

### 분할 전략 (`mr2s_module.solver.partition`)

`DnCGraphPartitionStrategyProtocol`(`run(graph) -> EmbeddableGraphPartition`) 구현체:

- `VertexCountPartitionStrategy(face_cycle, max_vertices)` — 정점 수 기준 분할
- `EmbeddingAwareFaceCyclePartitionStrategy` — 임베딩 가능 여부 기준 분할
- `DegeneracyPruningFaceCyclePartitionStrategy(mr2s_solver, face_cycle, target_graph)` — 임베딩 추정 + 프루닝

---

## 4. QUBO 백엔드 (`mr2s_module.qubo`)

### `QuboSolver`

`QuboSolverProtocol` 구현. 샘플러만 다른 SA/QA 백엔드를 정적 팩토리로 생성한다.

```python
QuboSolver.create_sa_solver(ranker: SolutionRankerProtocol, num_reads: int | None = None)
QuboSolver.create_qa_solver(ranker: SolutionRankerProtocol, num_reads: int = 100)
```

- `run(qubo: BinaryQuadraticModel, graph: Graph) -> Solution`
- `run_with_embedding(qubo, graph, embedding: dict) -> Solution` — 고정 임베딩 재사용.
  임베딩이 유효하지 않으면 `InvalidEmbeddingError`(`ValueError` 서브클래스).
- `create_qa_solver`는 D-Wave 자격증명이 없으면 `RuntimeError`.
  **환경변수 `DWAVE_API_TOKEN` 또는 `~/.config/dwave/dwave.conf`로 설정** (소스에 하드코딩 금지).

### 다항식 생성기 (`PolyGeneratorProtocol` 구현)

`run(graph) -> dimod.BinaryPolynomial`을 구현하며 `QuboMR2SSolver.poly_generators`에 주입한다.

- `FlowPolyGenerator()` — 흐름 균형 항
- `NHopPolyGenerator(small_world_spec: SmallWorldSpec)` — n-hop 도달성 항
  - `SmallWorldSpec(n_hops=[NHop(hop수, 가중치), ...])`, 예: `NHop(2, 1)`

---

## 5. 평가 (`mr2s_module.evaluator`)

### `Evaluator` (`EvaluatorProtocol` 구현)

`run(solution: Solution) -> Score`. 개별 지표도 직접 호출 가능:
`eval_apsp_sum`, `eval_strong_connect_rate`, `eval_flow`, `eval_sample_score`.

### Ranker (`SolutionRankerProtocol` 구현, `run(solution) -> float` — 낮을수록 좋은 샘플)

- `ApspSumRanker` — 샘플의 APSP 합으로 순위. 강연결이 아닌 샘플은 `inf`
- `SampleScoreRanker` — 항상 `0.0` 반환 → sample_set의 에너지 순서(BQM 목적함수 최적해)를 그대로 채택

---

## 6. 간선 방향 알고리즘 (`mr2s_module.edge_orient`)

`EdgeOrientationProtocol`(`run(graph) -> OrientationResult`) 구현. 솔버의 `edge_orienter`로
주입해 일부 간선 방향을 사전 고정하거나, `BaseEdgeOrientationSolver`로 감싸 단독 사용한다.

- `Robbin` — Robbins 정리 기반(ear decomposition) 강연결 방향 부여
- `Tjoin` — T-join 기반 방향 부여

## 7. 사이클/클러스터링 (`mr2s_module.cycle`)

DnC 분할에 사용되는 평면그래프 face 클러스터링.

- `FaceClusterPartition(target_k: int, clusterer)` — `FaceCycleProtocol` 구현(`run(graph) -> GraphPartitionResult`)
- clusterer 종류: `KMeansFaceClusterer()`, `BalancedFaceGraphClusterer()`, `SnowballFaceClusterer()`

## 8. 프로토콜 — 확장 포인트 (`mr2s_module.protocols`)

구조적 타이핑(`typing.Protocol`)이므로 상속 없이 시그니처만 맞추면 주입 가능하다.

| 프로토콜 | 시그니처 | 주입 위치 |
|---|---|---|
| `Mr2sSolverProtocol` | `evaluator` 속성, `run(graph) -> Solution` | `DnCMr2sSolver.mr2s_solver` |
| `EdgeOrientationProtocol` | `run(graph) -> OrientationResult` | 각 솔버의 `edge_orienter` |
| `EvaluatorProtocol` | `run(solution) -> Score` | 각 솔버의 `evaluator` |
| `QuboSolverProtocol` | `run(qubo, graph) -> Solution`, `run_with_embedding(...)` | `QuboMR2SSolver.qubo_solver` |
| `SolutionRankerProtocol` | `run(solution) -> float` | `QuboSolver.ranker` |
| `PolyGeneratorProtocol` | `run(graph) -> BinaryPolynomial` | `QuboMR2SSolver.poly_generators` |
| `FaceCycleProtocol` | `run(graph) -> GraphPartitionResult` | `DnCMr2sSolver.face_cycle` |
| `DnCGraphPartitionStrategyProtocol` | `run(graph) -> EmbeddableGraphPartition` | `DnCMr2sSolver.graph_partition_strategy` |

타입 별칭: `QuboMatrix = dimod.BinaryQuadraticModel`, `GraphType`/`EdgeType`/`Solution`/`Score`는 도메인 모델 별칭.

## 9. 유틸리티 (`mr2s_module.util`)

최상위에서 export되는 것:

- `estimate_required_qubits(bqm) -> EmbeddingEstimate` — D-Wave 임베딩 필요 큐빗 추정
- `map_binary_poly_to_bqm(poly) -> BinaryQuadraticModel` — 고차 이진 다항식을 2차(BQM)로 축약

`mr2s_module.util`에서 추가로 사용 가능: `add_polys`, `multiply_polys`, `get_indicator_function`,
`domain_graph_to_networkx` / `networkx_to_domain_graph`(도메인 ↔ networkx 변환),
`enumerate_faces`, `check_planar_embedding` 등 평면그래프 헬퍼, `robbins_orient`, `empty_binary_sample_set`.

---

## 사용 예시 모음

### QUBO + SA (기본 파이프라인)

```python
from mr2s_module import Graph, Edge, create_qubo_solver

solver = create_qubo_solver()
solution = solver.run(graph)
best = solution.score  # Score
```

### 대규모 그래프 — DnC + SA

```python
from mr2s_module import create_dnc_sa_solver

solver = create_dnc_sa_solver(max_vertices=80, random_seed=42)
solution = solver.run(graph)          # DnCSolution
print(len(solution.sub_graphs))       # 분할된 부분그래프 수
```

### D-Wave 양자 어닐러 사용

```python
# 사전 조건: DWAVE_API_TOKEN 환경변수 설정
from mr2s_module import create_qubo_qa_solver

solver = create_qubo_qa_solver()
estimate = solver.estimate_embedding(graph)   # 실행 전 큐빗 소요 확인
if estimate.has_physical_embedding:
    solution = solver.run_with_embedding(graph, estimate)  # 임베딩 재사용
else:
    solution = solver.run(graph)
```

### 커스텀 조립

```python
from mr2s_module import (
    QuboMR2SSolver, QuboSolver, SampleScoreRanker, Evaluator,
    FlowPolyGenerator, NHopPolyGenerator, SmallWorldSpec, NHop, Tjoin,
)

solver = QuboMR2SSolver(
    edge_orienter=Tjoin(),  # 일부 간선 방향을 사전 고정
    qubo_solver=QuboSolver.create_sa_solver(ranker=SampleScoreRanker(), num_reads=200),
    evaluator=Evaluator(),
    poly_generators=[
        FlowPolyGenerator(),
        NHopPolyGenerator(small_world_spec=SmallWorldSpec(n_hops=[NHop(2, 1)])),
    ],
)
solution = solver.run(graph)
```

## 주의사항

- `edge_orienter`가 지정된 솔버의 `run()`은 `graph.define_edge_direction()`을 호출하여
  **입력 `Graph`를 in-place로 변경**한다. 원본 보존이 필요하면 복사 후 전달할 것.
- `ApspSumRanker`와 `Score.apsp_sum`은 강연결이 아닌 해에 대해 `float("inf")`를 반환한다.
- DnC 계열은 평면그래프의 face 구조를 전제로 분할하므로 입력이 평면그래프여야 한다.
- QA 백엔드는 네트워크 호출이 발생하며 자격증명이 없으면 생성 시점에 `RuntimeError`를 던진다.
- 정점 ID는 `int`, 간선 키는 `frozenset[int]`(양끝점)이므로 두 정점 사이 다중 간선은 표현할 수 없다.
