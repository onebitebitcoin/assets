# Agent Rules

## Language
- 모든 답변은 한국어로 작성한다(코드/에러 로그는 원문 유지 가능).

## Workflow (반드시 지킬 것)
- 코드 변경 후 아래 순서로 마무리한다.
  1) 테스트 실행: `./scripts/run_testplan.sh` (또는 프로젝트 표준 테스트 커맨드)
  2) 결과가 PASS면 `git status` 확인
  3) 마지막에 `git add -A && git commit -m "<요약>" && git push` 수행
- 테스트가 FAIL이면: 실패 원인 수정 → 다시 테스트 → PASS 후 커밋/푸시.

## Notes
- git 작업이 샌드박스 권한 때문에 실패할 수 있다. 그 경우 git 커맨드는 사용자에게 실행을 요청한다.

