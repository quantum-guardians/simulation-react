# simulation_react

리액트로 개발하는 mr2s 시뮬레이션입니다.

CSV로 그래프(간선 목록)를 입력하면 자동 레이아웃 후 노드를 드래그로 조정할 수 있고,
"Generate Paths"를 누르면 각 간선의 weight에 비례한 폭을 가진 골목(복도)이 실제
이동 공간(벽 콜라이더 포함)으로 생성됩니다. 사람(작은 원)은 리프 노드 사이를
물리 엔진(matter.js) 기반으로 이동하며, 서로 부딪히면 콜라이더를 유지한 채
충돌/정체가 일어납니다. `mr2s_module`의 edge-orientation solver를 백엔드에서
실행해 방향 화살표/점수를 오버레이로 볼 수 있습니다.

## 아키텍처

```text
backend/    FastAPI, mr2s_module 래핑 (그래프 변환, solver 실행)
frontend/   React + TypeScript + Vite, 탑뷰 캔버스 + matter.js 물리 시뮬레이션
```

`mr2s_module`은 이 repo에 포함되어 있지 않고, 형제 디렉터리
`../mr2s-module` (`C:\Users\me\Desktop\Develope\mr2s-module`)에 있는 것을
editable install로 사용합니다.

## 실행 방법

### backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate  /  macOS-Linux: source .venv/bin/activate
pip install -r requirements.txt
pip install -e ../../mr2s-module   # mr2s_module 소스가 있는 형제 저장소를 editable로 설치
                                     # dwave-ocean-sdk 등 무거운 의존성이 함께 설치되므로 시간이 걸릴 수 있음
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

`mr2s_module`을 설치하지 않아도 서버는 뜨지만(`/api/health`가
`moduleAvailable: false`를 반환), solver 관련 엔드포인트는 500을 반환합니다.

### frontend

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 접속:

```text
http://localhost:5173
```

## 사용 흐름

1. 왼쪽 패널에 `node1,node2,weight` 형식의 CSV(간선 목록)를 붙여넣고
   "Parse & Layout"을 누릅니다. (예: `A,B,1` / `B,C,2` / `C,D,1`)
2. 자동 배치된 노드를 캔버스에서 드래그해 위치를 조정합니다.
3. "Number of people"에 원하는 인원 수를 직접 입력하고 "Generate Paths"를
   누르면 weight에 비례한 폭의 골목이 생성되고, 입력한 수만큼 사람이 리프
   노드 사이를 오가며 이동을 시작합니다. Play/Pause로 시뮬레이션을
   제어하고, 시뮬레이션 도중에도 숫자를 바꾼 뒤 "Add"를 누르면 그만큼
   사람이 추가로 투입됩니다.
4. Solver(robbin/ils/sa/qubo 계열/dnc 계열)를 선택하고 "Run Solver"를
   누르면 방향 화살표와 score(APSP sum, strong connect rate 등)가
   표시됩니다. 그래프에 bridge(다리 간선)가 있으면 경고가 표시되며,
   Robbin은 이 경우 방향을 지정하지 않고(구조적으로 불가능) 대신
   ils/sa/qubo/dnc 계열을 선택하면 방향이 지정됩니다.

## 테스트

```bash
# backend
cd backend
pytest

# frontend
cd frontend
npm run test
```

## 알려진 제한 사항 / 다음 단계

- 골목의 교차점(hub)은 현재 완전히 열린 원(Phase 1)으로 처리됩니다.
  실제 스트레스 테스트에서는 새는(leak) 현상이 없었지만, 그래프가 훨씬
  복잡해지면 hub 테두리를 벽으로 세분화하는 Phase 2 업그레이드가 필요할
  수 있습니다.
- 그리드/blockedCells 기반 입력(`/api/graph/from-grid`)과
  `/api/simulate/step`은 이번 작업 범위에서 의도적으로 구현하지
  않았습니다. Agent 이동은 전부 프런트엔드의 matter.js 물리 루프에서
  처리됩니다.
- `/api/partition` (DnC partition overlay)은 아직 구현되지 않았습니다.
