import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/photo-pipeline.js', import.meta.url), 'utf8');
function harness(options = {}) {
  const counters = { images: 0, bitmaps: 0, closed: 0, urls: 0, revoked: 0, encodes: 0, draws: 0, fetches: 0, maxCanvasPixels: 0 };
  const canvases = [], images = [], bitmapOptions = [], requests = [], forms = [], messages = [];
  const store = options.store || new Map();
  const dimensions = options.dimensions || { width: 5222, height: 6024, jpeg: true };
  class FakeImage {
    constructor() { this.naturalWidth = dimensions.width; this.naturalHeight = dimensions.height; counters.images++; images.push(this); }
    set src(value) { this._src = value; if (value) queueMicrotask(() => options.imageError ? this.onerror?.() : this.onload?.()); }
    get src() { return this._src; }
    removeAttribute() { this._src = ''; }
  }
  function canvas() {
    let width = 0, height = 0;
    const instance = {
      get width() { return width; }, set width(v) { width = v; measure(); },
      get height() { return height; }, set height(v) { height = v; measure(); },
      getContext() { return options.noContext ? null : { fillRect() {}, drawImage() { counters.draws++; if (options.drawError) throw new Error('secret-filename.jpg'); } }; },
      toBlob(cb, type, quality) {
        counters.encodes++;
        assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.9);
        if (options.encodeHangs) return;
        if (options.encodeThrows) throw new Error('sensitive-token');
        if (options.emptyEncode || (options.firstEncodeEmpty && counters.encodes === 1)) { queueMicrotask(() => cb(null)); return; }
        queueMicrotask(() => cb(new Blob(['encoded'], { type: options.outputType || 'image/jpeg' })));
      }
    };
    function measure() { counters.maxCanvasPixels = Math.max(counters.maxCanvasPixels, canvases.reduce((sum, c) => sum + c.width * c.height, 0)); }
    canvases.push(instance); return instance;
  }
  class FakeForm {
    constructor() { if (options.formThrows) throw new Error('secret-name'); this.values = []; forms.push(this); }
    append(...args) { this.values.push(args); }
  }
  const env = {
    Blob, setTimeout, clearTimeout,
    navigator: options.navigator || { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 },
    console: { warn(...args) { messages.push(args); } },
    localStorage: { getItem(k) { if (options.storageThrows) throw new Error(); return store.get(k) || null; }, setItem(k,v) { if (options.storageThrows) throw new Error(); store.set(k,v); } },
    Image: FakeImage,
    URL: { createObjectURL() { return `blob:test-${++counters.urls}`; }, revokeObjectURL() { counters.revoked++; } },
    document: { createElement(name) { assert.equal(name, 'canvas'); return canvas(); } },
    FormData: FakeForm,
    async fetch(url, config) {
      counters.fetches++; requests.push({ url, config });
      if (options.fetchThrows) throw new TypeError('secret-token in URL');
      const status = options.status || 200;
      return { status, ok: status >= 200 && status < 300,
        async json() { if (options.jsonThrows) throw new SyntaxError('secret-response'); return options.jsonResult === undefined ? { message: 'submitted' } : options.jsonResult; } };
    }
  };
  if (!options.noBitmap) env.createImageBitmap = async (file, args) => {
    counters.bitmaps++; bitmapOptions.push(args);
    if (options.bitmapThrows) throw new Error('secret-token in bitmap error');
    return { width: options.ignoreResize ? dimensions.width : args.resizeWidth || dimensions.width,
      height: options.ignoreResize ? dimensions.height : args.resizeHeight || dimensions.height,
      close() { counters.closed++; } };
  };
  const context = vm.createContext({ ...env });
  vm.runInContext(source, context);
  const pipeline = context.MoonPhotoPipeline.create(env, { timeoutMs: 30 });
  return { env, context, pipeline, counters, store, canvases, images, bitmapOptions, requests, forms, messages, dimensions,
    compress: () => pipeline.compress({ size: options.fileSize || 9 * 1024 * 1024, name: 'private-student.jpg' }, async () => dimensions) };
}
function clean(h) {
  assert.equal(h.counters.urls, h.counters.revoked);
  assert.ok(h.images.every(img => img.src === ''));
  assert.ok(h.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
}

for (const dimensions of [{width:5222,height:6024,jpeg:true},{width:4015,height:4594,jpeg:true},{width:8000,height:6000,jpeg:true}]) {
  test(`iOS ${dimensions.width}x${dimensions.height}: bypass bitmap, small canvas, cleanup`, async () => {
    const h = harness({ dimensions }); const blob = await h.compress();
    assert.equal(blob.type, 'image/jpeg'); assert.equal(h.counters.bitmaps, 0); assert.equal(h.counters.images, 1);
    assert.ok(h.counters.maxCanvasPixels <= 3000000); clean(h);
    for (const phase of ['header','decode','canvas','drawImage','toBlob']) assert.ok(h.pipeline.diagnostic.report().events.some(e => e.stage===phase && e.event==='ok'));
  });
}

test('iPad desktop UA selects iOS path', async () => {
  const h = harness({ navigator: {userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5} }); await h.compress(); assert.equal(h.counters.bitmaps,0); clean(h);
});
test('31 MP JPEG still accepted without createImageBitmap', async () => { const h=harness({noBitmap:true});await h.compress();assert.equal(h.counters.images,1);clean(h); });
test('desktop uses resized bitmap', async () => {const h=harness({navigator:{userAgent:'Chrome',platform:'Win32'}});await h.compress();assert.equal(h.counters.bitmaps,1);assert.equal(h.counters.images,0);assert.equal(h.counters.closed,1);assert.ok(h.counters.maxCanvasPixels<=6553600);clean(h);});
test('bitmap rejection falls back to Image and does not leak raw error', async () => {
 const h=harness({navigator:{userAgent:'Chrome'},bitmapThrows:true});await h.compress();assert.equal(h.counters.images,1);assert.ok(h.pipeline.diagnostic.report().events.some(e=>e.event==='fallback'));assert.ok(!JSON.stringify(h.pipeline.diagnostic.report()).includes('secret'));clean(h);
});
test('bitmap ignoring resize is closed before fallback', async () => { const h=harness({navigator:{userAgent:'Chrome'},ignoreResize:true});await h.compress();assert.equal(h.counters.closed,1);assert.equal(h.counters.images,1);clean(h); });
test('source >20 MiB rejected before decoding', async () => { const h=harness({fileSize:21*1024*1024});await assert.rejects(h.compress(),e=>e.photoCode==='SOURCE_SIZE');assert.equal(h.counters.images,0);clean(h); });
test('oversized JPEG rejected before decoding', async () => {const h=harness({dimensions:{width:10000,height:10000,jpeg:true}});await assert.rejects(h.compress(),e=>e.photoCode==='SOURCE_PIXELS');assert.equal(h.counters.images,0);});
test('non-JPEG pixel safety limit is not silently removed', async () => {const h=harness({dimensions:{width:5000,height:5000,jpeg:false}});await assert.rejects(h.compress(),e=>e.photoCode==='SOURCE_PIXELS');assert.equal(h.counters.images,0);});
test('PNG and WebP within cap use native oriented dimensions', async () => {const h=harness({dimensions:{width:3000,height:4000,jpeg:false}});await h.compress();clean(h);});
for(const [name,options,stage] of [['image failure',{imageError:true},'decode'],['canvas allocation failure',{noContext:true},'canvas'],['draw failure',{drawError:true},'drawImage'],['encoder throws',{encodeThrows:true},'toBlob'],['encoder returns wrong MIME',{outputType:'image/png'},'toBlob'],['encoder never calls back',{encodeHangs:true},'toBlob']]) {
 test(`${name}: stage logged and resources released`,async()=>{const h=harness(options);await assert.rejects(h.compress());assert.ok(h.pipeline.diagnostic.report().events.some(e=>e.stage===stage&&e.event==='error'));clean(h);});
}
test('null toBlob retries smaller canvas without decoding original twice',async()=>{const h=harness({firstEncodeEmpty:true});await h.compress();assert.equal(h.counters.images,1);assert.equal(h.counters.encodes,2);assert.ok(h.counters.maxCanvasPixels<=4000000);clean(h);});
test('two null encodes fail, unlock and clean resources',async()=>{const h=harness({emptyEncode:true});await assert.rejects(h.compress(),e=>e.photoCode==='EMPTY_BLOB');await assert.rejects(h.compress(),e=>e.photoCode==='EMPTY_BLOB');assert.equal(h.counters.images,2);assert.equal(h.counters.encodes,4);clean(h);});
test('concurrent decodes are rejected rather than overlap',async()=>{const h=harness();const first=h.compress();await assert.rejects(h.compress(),e=>e.photoCode==='PHOTO_BUSY');await first;assert.equal(h.counters.images,1);clean(h);});
test('storage-disabled browsers keep working',async()=>{const h=harness({storageThrows:true});await h.compress();assert.equal(h.pipeline.diagnostic.report().storageAvailable,false);clean(h);});
test('repeat 6 high-resolution selections without live canvas/URL accumulation',async()=>{const h=harness();for(let i=0;i<6;i++){await h.compress();clean(h);}assert.equal(h.counters.images,6);assert.ok(h.counters.maxCanvasPixels<=3000000);});
const values={studentNumber:'7',studentName:' SECRET-STUDENT ',observedAt:'2026-09-11T08:00',memo:' SECRET-MEMO '};
const photo=new Blob(['fake JPEG'],{type:'image/jpeg'});
test('FormData contract matches original API; no private values in diagnostics',async()=>{const h=harness();await h.pipeline.send(values,photo,'PRIVATE-REQUEST-ID');assert.deepEqual(h.forms[0].values.map(v=>v[0]),['requestId','studentNumber','studentName','observedAt','memo','photo']);assert.equal(h.requests[0].url,'/api/observations');assert.equal(h.requests[0].config.credentials,'same-origin');assert.deepEqual(h.forms[0].values.at(-1),['photo',photo,'moon.jpg']);assert.equal(h.forms[0].values[2][1],'SECRET-STUDENT');const log=JSON.stringify(h.pipeline.diagnostic.report());for(const text of ['SECRET','PRIVATE-REQUEST','fake JPEG','private-student'])assert.ok(!log.includes(text));});
test('FormData exception logs correct stage and does not fetch',async()=>{const h=harness({formThrows:true});await assert.rejects(h.pipeline.send(values,photo,'same-id'));assert.equal(h.counters.fetches,0);assert.ok(h.pipeline.diagnostic.report().events.some(e=>e.stage==='FormData'&&e.event==='error'));});
test('network failure has no automatic POST retry',async()=>{const h=harness({fetchThrows:true});await assert.rejects(h.pipeline.send(values,photo,'same-id'));assert.equal(h.counters.fetches,1);assert.ok(h.pipeline.diagnostic.report().events.some(e=>e.stage==='fetch'&&e.event==='error'));assert.ok(!JSON.stringify(h.messages).includes('secret-token'));});
test('HTTP failures retain status and distinguish authentication errors',async()=>{const h=harness({status:401});const {response}=await h.pipeline.send(values,photo,'id');assert.equal(response.status,401);assert.ok(h.pipeline.diagnostic.report().events.some(e=>e.stage==='fetch'&&e.event==='error'&&e.status===401));});
test('malformed successful response is uncertain, not falsely submitted',async()=>{const h=harness({jsonThrows:true});await assert.rejects(h.pipeline.send(values,photo,'id'),e=>e.photoCode==='UPLOAD_RESULT_UNKNOWN');assert.equal(h.counters.fetches,1);});
test('stored incomplete stage survives a new execution without claiming crash cause',()=>{const h=harness();h.pipeline.diagnostic.record('start','drawImage',{width:100,height:100});const other=harness({store:h.store});assert.equal(other.pipeline.diagnostic.report().interrupted.stage,'drawImage');});
test('metadata whitelist strips filenames, form fields, stacks and URLs',()=>{const h=harness();h.pipeline.diagnostic.record('error','decode',{width:10,name:'secret',studentName:'secret',message:'secret',stack:'secret',url:'secret',errorName:'Error'});assert.ok(!JSON.stringify(h.pipeline.diagnostic.report()).includes('secret'));});
test('geometry cap does not enlarge small images',()=>{const h=harness();assert.deepEqual(JSON.parse(JSON.stringify(h.context.MoonPhotoPipeline.fit(80,40,2048,3000000))),{width:80,height:40});});
