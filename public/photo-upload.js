/* Compatibility adapter for the classic-script student page. Ordered deferred
 * scripts run after index.html's inline code and before DOMContentLoaded; inline
 * handlers resolve these global functions at invocation time. Original handlers
 * remain a fallback when the module fails to load. Storage-service APIs are unchanged.
 */
/* global photoProcessing, submissionBusy, compressedImageBlob:writable,
 pendingRequestId:writable, previewObjectUrl:writable, hasClassSession:writable, galleryLoaded */
(function (root) {
  'use strict';
  const form = root.document.getElementById('observationForm');
  if (!form || !root.MoonPhotoPipeline || typeof root.readPhotoDimensions !== 'function') return;
  if (form.dataset.photoPipelineVersion === root.MoonPhotoPipeline.version) return;
  const pipeline = root.MoonPhotoPipeline.create(root);
  form.dataset.photoPipelineVersion = root.MoonPhotoPipeline.version;
  const byId = id => root.document.getElementById(id);
  root.compressImage = file => pipeline.compress(file, root.readPhotoDimensions);

  root.previewPhoto = async function (event, source = 'gallery') {
    const input = event.target;
    if (photoProcessing || submissionBusy) { input.value = ''; return; }
    if (source === 'capture' && typeof root.clearCameraPending === 'function') root.clearCameraPending();
    const file = input.files && input.files[0];
    if (!file || !file.size) { input.value = ''; return; }
    const previousPreview = previewObjectUrl;
    root.setPhotoBusy(true);
    try {
      root.saveObservationDraft();
      root.stopCamera();
      // Release display pixels, NOT the previous Blob/requestId. A failed replacement
      // must not silently discard a photo that was already attached.
      byId('photoPreview').removeAttribute('src');
      input.value = '';
      root.showPhotoStatus('사진 크기를 줄여 제출용으로 준비하고 있어요…', false);
      const blob = await root.compressImage(file);
      await pipeline.diagnostic.step('preview', () => root.attachPhoto(blob), { bytes: blob.size });
    } catch (error) {
      if (previousPreview && compressedImageBlob) byId('photoPreview').src = previousPreview;
      const stage = error && error.photoStage;
      const suffix = stage ? ` [${stage}]` : '';
      root.showPhotoStatus((error && error.message ? error.message : '사진을 처리하지 못했습니다.') + suffix, true);
    } finally {
      input.value = '';
      root.setPhotoBusy(false);
    }
  };

  root.submitObservation = async function (event) {
    event.preventDefault();
    if (photoProcessing || submissionBusy) return;
    if (!compressedImageBlob) { root.showPhotoStatus('달 사진을 먼저 촬영하거나 선택해 주세요.', true); return; }
    root.setSubmitBusy(true);
    try {
      root.showSubmitStatus('수업 제출함에 사진을 저장하고 있어요…', false);
      if (!pendingRequestId) pendingRequestId = root.crypto.randomUUID();
      const { response, result } = await pipeline.send({
        studentNumber: byId('studentNumber').value,
        studentName: byId('studentName').value,
        observedAt: byId('observedAt').value,
        memo: byId('memo').value
      }, compressedImageBlob, pendingRequestId);
      if (response.status === 401) { hasClassSession = false; await root.checkSession(); }
      if (!response.ok) throw new Error(result.message || '사진을 제출하지 못했습니다.');
      root.showSubmitStatus(result.message || '사진을 제출했습니다.', false, true);
      form.reset();
      root.clearObservationDraft();
      byId('captureInput').value = '';
      byId('photoInput').value = '';
      compressedImageBlob = null;
      pendingRequestId = '';
      if (previewObjectUrl) root.URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = '';
      byId('photoPreview').removeAttribute('src');
      byId('photoPreviewWrap').classList.add('hidden');
      byId('photoPlaceholder').classList.remove('hidden');
      root.hidePhotoStatus();
      root.stopCamera();
      root.setObservedAtNow();
      if (galleryLoaded) root.refreshGallery();
      root.showToast('달 관찰 사진을 제출했어요! 🌙');
    } catch (error) {
      const message = error && error.photoCode === 'UPLOAD_RESULT_UNKNOWN'
        ? '서버 응답을 확인하지 못했습니다. 우리 반 갤러리에서 제출 여부를 확인해 주세요. 재시도해도 같은 요청 번호를 사용합니다.'
        : error && error.message ? error.message : '제출하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      root.showSubmitStatus(message, true);
    } finally {
      // Covers FormData/UUID exceptions as well as network and response failures.
      root.setSubmitBusy(false);
    }
  };

  function addDiagnosticControls() {
    if (byId('photoDiagnostic')) return;
    const details = root.document.createElement('details');
    details.id = 'photoDiagnostic';
    details.className = 'mt-3 rounded-2xl border border-space-700 px-4 py-3 text-sm';
    const summary = root.document.createElement('summary');
    summary.textContent = '사진 오류 진단 기록';
    const notice = root.document.createElement('p');
    notice.textContent = '처리 단계·크기·오류 종류만 이 브라우저에 기록합니다. 사진, 파일명, 이름, 관찰 내용, 인증 정보는 포함하지 않습니다.';
    const status = root.document.createElement('p');
    status.setAttribute('role', 'status');
    const text = root.document.createElement('textarea');
    text.readOnly = true;
    text.hidden = true;
    text.rows = 8;
    text.className = 'mt-2 w-full rounded-xl bg-space-900 px-3 py-2 text-xs';
    text.setAttribute('aria-label', '사진 처리 진단 JSON');
    const report = () => {
      text.value = JSON.stringify(pipeline.diagnostic.report(), null, 2);
      text.hidden = false;
      return text.value;
    };
    const copy = root.document.createElement('button');
    copy.type = 'button';
    copy.className = 'mt-3 rounded-xl border px-4 py-3';
    copy.textContent = '진단 기록 복사';
    copy.addEventListener('click', async () => {
      const value = report();
      try { await root.navigator.clipboard.writeText(value); status.textContent = '진단 기록을 복사했습니다.'; }
      catch (_) { text.focus(); text.select(); status.textContent = '자동 복사가 차단되어 기록을 표시했습니다. 직접 복사해 주세요.'; }
    });
    const download = root.document.createElement('button');
    download.type = 'button';
    download.className = 'mt-3 rounded-xl border px-4 py-3';
    download.textContent = '진단 JSON 저장';
    download.addEventListener('click', () => {
      const value = report();
      try {
        const url = root.URL.createObjectURL(new root.Blob([value], { type: 'application/json' }));
        const link = root.document.createElement('a');
        link.href = url;
        link.download = 'moon-photo-diagnostic.json';
        link.click();
        root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
        status.textContent = '진단 JSON 저장을 요청했습니다.';
      } catch (_) { status.textContent = '파일 저장을 사용할 수 없습니다. 표시된 기록을 복사해 주세요.'; }
    });
    details.append(summary, notice, copy, download, status, text);
    form.appendChild(details);
  }
  addDiagnosticControls();
})(globalThis);
