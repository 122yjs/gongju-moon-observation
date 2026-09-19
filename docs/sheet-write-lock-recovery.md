# 시트 쓰기 잠금 복구

Google Sheets 쓰기 결과가 불명확하거나 작업 프로세스가 중단되면 잠금은 자동으로 풀리지 않습니다. 같은 시트의 후속 쓰기를 막아 중복 저장과 다른 학생 행 수정을 피하기 위한 fail-closed 정책입니다.

운영자는 먼저 잠금과 기록된 의도를 확인합니다.

```sh
npx wrangler d1 execute DB --remote --command \
  "SELECT spreadsheet_id, teacher_id, owner_token, operation, observation_id, expected_version, intended_version, state, created_at FROM sheet_write_locks;"
```

`active` 잠금은 요청이 아직 실행 중일 수 있으므로, 원래 요청 프로세스가 끝났음을 확인하기 전에는 절대 해제하지 않습니다. 해당 Google 시트의 실제 행과 작업 로그를 대조하고 Google의 지연된 쓰기까지 끝났는지 확인합니다. 적용 여부가 불명확하거나 일부만 적용됐거나 지연 작업을 확인하지 못했다면 잠금을 유지하고 데이터를 먼저 바로잡습니다.

적용 상태를 확정하고 후속 쓰기가 안전하다고 판단한 뒤에만 조회한 잠금 한 건을 삭제합니다. 아래의 `SPREADSHEET_ID`, `OWNER_TOKEN`, `STATE`는 같은 조회 행의 실제 값으로 바꿉니다.

```sh
npx wrangler d1 execute DB --remote --command \
  "DELETE FROM sheet_write_locks WHERE spreadsheet_id = 'SPREADSHEET_ID' AND owner_token = 'OWNER_TOKEN' AND state = 'STATE';"
```

로컬 개발 DB를 확인할 때는 `--remote` 대신 `--local`을 사용합니다. UI에는 강제 해제 기능이 없습니다.
