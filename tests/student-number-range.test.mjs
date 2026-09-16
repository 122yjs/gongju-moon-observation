import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../lib/observations.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const exports = {};
runInNewContext(source, {
  exports,
  require: () => ({ HttpError }),
  File,
  FormData,
  Date,
  Intl,
  Uint8Array,
  DataView,
  String,
  Array,
  Set,
  btoa,
  atob,
});

function currentObservedAt() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(' ', 'T');
}

function formFor(studentNumber) {
  const form = new FormData();
  form.set('requestId', '00000000-0000-4000-8000-000000000001');
  form.set('studentNumber', String(studentNumber));
  form.set('studentName', '테스트');
  form.set('observedAt', currentObservedAt());
  form.set('photoCapturedAt', '');
  form.set('memo', '');
  form.set('photo', new File(['synthetic'], 'moon.jpg', { type: 'image/jpeg' }));
  return form;
}

test('accepts attendance number 100', () => {
  const input = exports.validateObservationForm(formFor(100));
  assert.equal(input.studentNumber, 100);
});

test('rejects attendance number 101', () => {
  assert.throws(
    () => exports.validateObservationForm(formFor(101)),
    (error) => error instanceof HttpError && error.status === 400 && /1번부터 100번/.test(error.message),
  );
});
