import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../app/api/photos/heic/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function heicBytes() {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24, false);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  bytes.set([0x68, 0x65, 0x69, 0x63], 8); // heic
  bytes.set([0x68, 0x65, 0x69, 0x63], 16); // compatible brand
  return bytes;
}

function harness(overrides = {}) {
  const calls = [];
  const services = {
    getStudentSession: async () => ({ teacherId: 'class-a', sid: 'student-session' }),
    isHeicImage: () => true,
    readHeicCaptureTime: () => '2026-09-16T20:10',
    assertSameOrigin() {},
    HttpError,
    errorResponse(error) {
      return Response.json({ message: error.message }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
    },
    getEnv: () => ({
      IMAGES: {
        input(stream) {
          calls.push(['input', stream]);
          return {
            transform(options) {
              calls.push(['transform', options]);
              return {
                async output(options) {
                  calls.push(['output', options]);
                  return {
                    response({ headers } = {}) {
                      calls.push(['response', headers]);
                      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
                        status: 200,
                        headers: { ...Object.fromEntries(new Headers(headers)), 'Content-Type': 'image/jpeg' },
                      });
                    },
                  };
                },
              };
            },
          };
        },
      },
    }),
    ...overrides,
  };
  const exports = {};
  runInNewContext(source, {
    exports,
    require: () => services,
    Blob,
    Headers,
    Request,
    Response,
    Uint8Array,
    ArrayBuffer,
    Number,
  });
  const request = () => new Request('https://test.invalid/api/photos/heic', {
    method: 'POST',
    headers: { Origin: 'https://test.invalid', 'Content-Type': 'application/octet-stream' },
    body: heicBytes(),
  });
  return { post: () => exports.POST(request()), calls };
}

test('converts authenticated HEIC with bounded metadata-free Cloudflare Images options', async () => {
  const h = harness();
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  assert.equal(response.headers.get('X-Photo-Captured-At'), '2026-09-16T20:10');

  const transform = h.calls.find(([name]) => name === 'transform')?.[1];
  assert.deepEqual(JSON.parse(JSON.stringify(transform)), {
    width: 2560,
    height: 2560,
    fit: 'scale-down',
    metadata: 'none',
  });
  const output = h.calls.find(([name]) => name === 'output')?.[1];
  assert.deepEqual(JSON.parse(JSON.stringify(output)), { format: 'image/jpeg', quality: 90, anim: false });
});

test('rejects HEIC conversion without a student class session before Images is called', async () => {
  const h = harness({ getStudentSession: async () => null });
  const response = await h.post();
  assert.equal(response.status, 401);
  assert.equal(h.calls.some(([name]) => name === 'input'), false);
});

test('rejects a non-HEIC body before Images is called', async () => {
  const h = harness({ isHeicImage: () => false });
  const response = await h.post();
  assert.equal(response.status, 415);
  assert.equal(h.calls.some(([name]) => name === 'input'), false);
});
