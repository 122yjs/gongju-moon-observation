# 시트 쓰기 잠금 복구

Google Sheets 쓰기 결과가 불명확하거나 작업 프로세스가 중단되면 잠금은 시간 경과만으로 풀리지 않습니다. 같은 시트의 후속 쓰기를 막아 중복 저장과 다른 학생 행 수정을 피하기 위한 fail-closed 정책입니다.

## 교사 화면의 시트 연결 점검

`시트 연결 점검`은 다음 두 경우에만 저장 결과를 확인하고 잠금을 해제합니다.

- 기존 `uncertain` 작업의 의도한 변경이 시트에서 확인되는 경우.
- 생성 후 5분 이상 지난 `active` **단일 append**이며, 같은 학급의 같은 관찰 ID와 의도한 내용 버전이 실제 시트에서 모두 확인되는 경우. 이때 기존 제출 영수증도 해당 학급·요청 ID에 한정하여 완료 상태로 보정합니다.

5분은 확인을 시도할 수 있는 기준이지 잠금의 만료 시간이 아닙니다. 행이 없거나 내용이 다르거나 최근 요청이거나 다단계 변경인 경우 강제 해제하지 않습니다. 이 경우에는 아래 운영자 대조가 여전히 필요합니다. Drive 파일만 있다고 해서 Sheets 저장 완료로 간주하지 않습니다.

신규 단일 append가 Google로부터 명확한 400/401/403/404/413/429 거부 응답을 받으면 해당 요청의 잠금만 정리하고 원래 오류를 반환합니다. 자동 재전송은 하지 않습니다. 통신 단절·5xx·다단계 쓰기는 이 예외에 포함되지 않습니다.

## 운영자 대조

운영자는 먼저 잠금과 기록된 의도를 확인합니다.

```sh
npx wrangler d1 execute DB --remote --command \
  "SELECT spreadsheet_id, teacher_id, owner_token, operation, observation_id, expected_version, intended_version, state, created_at FROM sheet_write_locks;"
```

교사 화면에서 저장 완료가 확인되지 않는 `active` 잠금은 원래 요청 프로세스가 끝났음을 확인하기 전에는 절대 강제로 해제하지 않습니다. 해당 Google 시트의 실제 행과 작업 로그를 대조하고 Google의 지연된 쓰기까지 끝났는지 확인합니다. 적용 여부가 불명확하거나 일부만 적용됐거나 지연 작업을 확인하지 못했다면 잠금을 유지하고 데이터를 먼저 바로잡습니다.

적용 상태를 확정하고 후속 쓰기가 안전하다고 판단한 뒤에만 조회한 잠금 한 건을 삭제합니다. 아래의 `SPREADSHEET_ID`, `OWNER_TOKEN`, `STATE`는 같은 조회 행의 실제 값으로 바꿉니다.

```sh
npx wrangler d1 execute DB --remote --command \
  "DELETE FROM sheet_write_locks WHERE spreadsheet_id = 'SPREADSHEET_ID' AND owner_token = 'OWNER_TOKEN' AND state = 'STATE';"
```

로컬 개발 DB를 확인할 때는 `--remote` 대신 `--local`을 사용합니다. UI에는 강제 해제 기능이 없습니다.
