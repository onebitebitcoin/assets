# Claude Project Rules

## Language
- 모든 답변은 한국어로 작성한다.
- 코드/로그/에러 메시지는 원문 유지, 설명은 한국어로 한다.

## Writing / UI Guidelines
1) 이모지를 사용하지 말고 아이콘을 사용할 것  
   - 텍스트에서 이모지 금지
   - UI에서는 아이콘 컴포넌트(예: lucide-react) 사용
2) 중첩된 카드뷰는 사용하지 말 것  
   - Card 내부에 Card 중첩 금지
   - 섹션 분리는 divider/heading/spacing/background로 처리
3) 모바일 친화적인 레이아웃으로 적용할 것  
   - Mobile-first 레이아웃
   - 작은 화면 가독성/터치 타깃 최우선
4) 시간/날짜는 항상 한국 시간(Asia/Seoul)을 기준으로 판단한다.
5) fallback 더미 값 주입으로 흐름을 숨기지 말 것  
   - 디버깅을 어렵게 하므로 기본/더미 값으로 덮어쓰지 않는다.  
   - 문제가 발생하면 에러 메시지를 명확히 노출한다.
6) 사용자 작업에는 성공/실패 메시지를 항상 노출할 것  
   - 저장/추가/삭제/새로고침 등 주요 액션의 결과를 명확히 표시한다.

## Logging
- 백엔드: `backend/debug.log`에 파일로 로깅
- 프론트엔드: `frontend/debug.log`에 파일로 로깅
- stdout도 함께 출력하되, 반드시 파일에도 기록되어야 한다.

## Workflow
- 코드 수정 후 항상:
  1) 테스트 실행 → PASS/FAIL 확인
  2) FAIL이면 수정 후 재테스트
  3) PASS면 마지막에 `git add` → `git commit` → `git push`까지 수행

## Git
4) git commit message는 알아서 만들 것  
   - 변경 내용 기반으로 명확한 메시지를 자동 생성
   - 커밋 메시지는 한국어로 작성한다.
   - 가능하면 Conventional Commits 사용
- 단, 환경 제약으로 git이 실패하면 사용자에게 원인/대안 커맨드를 안내한다.
