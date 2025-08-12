/*
 * downloadHLSAsMKV.js — 使用 ffmpeg.wasm 合併為 .mkv
 * -------------------------------------------------
 * 用法（Usage）
 * -------------------------------------------------
 * await downloadHLSAsMKV({
 *   m3u8Url: 'https://.../chunklist.m3u8',         // 必填：媒體 m3u8（非 master）
 *   fileName: 'video.mkv',                          // 選填：輸出檔名（副檔名可省略，會自動補 .mkv）
 *   headers: { Origin: 'https://ani.gamer.com.tw',  // 選填：自訂標頭，常用為 Origin/Referer
 *             Referer: location.href },
 *   signal: abortController?.signal,                // 選填：AbortSignal
 *   concurrency: 8,                                 // 選填：同時下載分段數（預設 8）
 *   onProgress: (p) => {                            // 回呼：每次進度更新都會帶出 p.msg
 *     // p: { phase, percent, done, total, bytesDownloaded, msg }
 *     infoDisplay.textContent = p.msg;              // 例如：主程式只需顯示 p.msg
 *   }
 * });
 *
 * 註：
 * - 僅支援 TS 切片 + 可選 AES-128 (AES-CBC)；不支援 SAMPLE-AES/DRM 與 fMP4(.m4s)。
 * - 以 ffmpeg.wasm（FFmpeg WebAssembly）封裝成 MKV（Matroska）。
 * - 訊息（msg）統一由本檔產生，phase：prepare → master → downloading → transmux → finalize → done。
 */
(function () {
  'use strict';
  // ===== 版本（Version） =====
  const DWHLS_VERSION = '2.0';

  // ===================== 型別註解（JSDoc） =====================
  /**
   * @typedef {Object} ProgressPayload
   * @property {'prepare'|'master'|'downloading'|'transmux'|'finalize'|'done'} phase
   * @property {number} [percent]
   * @property {number} [done]
   * @property {number} [total]
   * @property {number} [bytesDownloaded]
   * @property {string} msg
   */

  /**
   * @typedef {Object} HLSOptions
   * @property {string} m3u8Url
   * @property {string} [fileName]
   * @property {Object.<string,string>} [headers]
   * @property {AbortSignal} [signal]
   * @property {(p: ProgressPayload)=>void} [onProgress]
   * @property {number} [concurrency]
   */

  // ===================== 小工具 =====================
  const hasGM = typeof GM_xmlhttpRequest === 'function';

  function gmFetchText(url, headers = {}) {
    if (!hasGM) return fetch(url, { headers }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, headers, responseType: 'text', onload: r => resolve(r.responseText), onerror: reject, ontimeout: reject });
    });
  }
  function gmFetchArrayBuffer(url, headers = {}) {
    if (!hasGM) return fetch(url, { headers }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, headers, responseType: 'arraybuffer', onload: r => resolve(r.response), onerror: reject, ontimeout: reject });
    });
  }

  async function ensureFFmpegNS() {
    // 嘗試載入 @ffmpeg/ffmpeg 的 UMD 版（提供全域 FFmpeg 物件）
    if (typeof FFmpeg !== 'undefined' && FFmpeg.createFFmpeg) return FFmpeg;

    const candidates = [
      'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js',
      'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js'
    ];
    let lastErr = null;
    for (const u of candidates) {
      try {
        const code = await gmFetchText(u);
        (new Function(code))(); // 定義 window.FFmpeg
        if (typeof FFmpeg !== 'undefined' && FFmpeg.createFFmpeg) return FFmpeg;
      } catch (e) { lastErr = e; }
    }
    throw new Error('ffmpeg.wasm 載入失敗' + (lastErr ? `：${lastErr}` : ''));
  }

  async function loadFFmpegWithFallback(report) {
    const ns = await ensureFFmpegNS();
    const coreCandidates = [
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
      'https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js'
    ];
    let lastErr = null;
    for (const corePath of coreCandidates) {
      try {
        const ffmpeg = ns.createFFmpeg({ log: false, corePath });
        // 讓 transmux 階段也能回報進度（ratio 0~1）
        ffmpeg.setProgress(({ ratio }) => {
          const percent = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
          report({ phase: 'transmux', percent, msg: '合併中...' });
        });
        await ffmpeg.load();
        return ffmpeg;
      } catch (e) { lastErr = e; }
    }
    throw new Error('ffmpeg-core 載入失敗' + (lastErr ? `：${lastErr}` : ''));
  }

  function toAbs(u, base) { return new URL(u, base).href; }

  function parseMediaM3U8(text, base) {
    const lines = String(text).trim().split(/\r?\n/);
    const segments = [];
    let seq = 0, keyInfo = null, hasFMP4 = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l.startsWith('#EXT-X-MAP') && l.includes('URI=')) {
        hasFMP4 = true; // fMP4 流（.m4s），此流程不處理
      } else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        seq = parseInt(l.split(':')[1], 10) || 0;
      } else if (l.startsWith('#EXT-X-KEY')) {
        const raw = l.slice(l.indexOf(':') + 1);
        const attrs = {};
        raw.split(',').forEach(kv => {
          const [k, v] = kv.split('=');
          attrs[k.trim()] = v ? v.trim().replace(/^"|"$/g, '') : '';
        });
        keyInfo = { method: attrs.METHOD, uri: attrs.URI ? toAbs(attrs.URI, base) : null, iv: attrs.IV || null };
      } else if (!l.startsWith('#')) {
        const url = toAbs(l, base);
        segments.push({ url, sn: seq++ });
      }
    }
    return { segments, keyInfo, hasFMP4 };
  }

  function ivFromHex(ivStr) {
    const hex = ivStr.startsWith('0x') ? ivStr.slice(2) : ivStr;
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function ivFromSeq(sn) {
    const iv = new Uint8Array(16);
    const dv = new DataView(iv.buffer);
    dv.setUint32(12, sn >>> 0);
    return iv;
  }
  async function aes128cbcDecrypt(keyBytes, ivBytes, cipherBytes) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, cipherBytes);
    return new Uint8Array(plain);
  }

  async function yieldToUI() {
    await new Promise(requestAnimationFrame);
    await new Promise(r => setTimeout(r, 0));
  }

  // ===================== 訊息產生（集中於本檔） =====================
  function formatMB(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n / 1048576);
  }
  function pctStr(v) {
    return (typeof v === 'number') ? `(${Math.max(0, Math.min(100, Math.round(v)))}%)` : '';
  }
  function buildMsg(p) {
    switch (p.phase) {
      case 'prepare': return '準備中...';
      case 'master': return '解析清單...';
      case 'downloading': {
        const parts = ['下載中'];
        if (Number.isFinite(p.done) && Number.isFinite(p.total)) parts.push(`${p.done}/${p.total}`);
        if (Number.isFinite(p.percent)) parts.push(pctStr(p.percent));
        return parts.join(' ');
      }
      case 'transmux':
      case 'finalize':
        return '合併中...';
      case 'done':
        return '完成！';
      default:
        return p.status || '處理中...';
    }
  }

  function makeReporter(onProgress) {
    let last = {};
    return function report(patch) {
      const p = Object.assign({ phase: 'prepare', done: 0, total: 0, percent: 0, bytesDownloaded: 0 ,msg: 'None'}, last, patch);
      p.msg = buildMsg(p);
      last = p;
      if (typeof onProgress === 'function') onProgress(p);
    };
  }

  function stripExt(name) {
    return String(name || '').replace(/\.[^/.]+$/, '');
  }

  // ===================== 主函式（ffmpeg.wasm → MKV） =====================
  /** @param {HLSOptions} opts */
  async function downloadHLSAsMKV(opts) {
    const {
      m3u8Url,
      fileName = 'video.mkv',
      headers = {},
      signal,
      onProgress,
      concurrency = 8
    } = opts || {};

    if (!m3u8Url) throw new Error('m3u8Url 必填');

    const report = makeReporter(onProgress);

    // ---- 準備 ----
    report({ phase: 'prepare', percent: 0 });

    const m3u8Text = await gmFetchText(m3u8Url, headers);
    report({ phase: 'master' });

    const { segments, keyInfo, hasFMP4 } = parseMediaM3U8(m3u8Text, m3u8Url);
    if (hasFMP4) throw new Error('偵測到 fMP4（.m4s）切片，目前僅支援 TS。');
    if (!segments.length) throw new Error('解析不到任何切片。');

    // ---- 金鑰 ----
    let keyBytes = null, useAES = false;
    if (keyInfo && keyInfo.method === 'AES-128' && keyInfo.uri) {
      const keyBuf = await gmFetchArrayBuffer(keyInfo.uri, headers);
      keyBytes = new Uint8Array(keyBuf);
      useAES = true;
    } else if (keyInfo && keyInfo.method && keyInfo.method !== 'NONE') {
      throw new Error('遇到非 AES-128 的加密（例如 SAMPLE-AES/DRM），純 JS 無法處理。');
    }

    // ---- 下載 ----
    const total = segments.length;
    const outTS = new Array(total);
    let done = 0, bytesDownloaded = 0;

    let aborted = false; if (signal) signal.addEventListener('abort', () => { aborted = true; });

    report({ phase: 'downloading', done, total, percent: 0, bytesDownloaded });

    const CONCURRENCY = Math.max(1, Math.floor(concurrency));
    let cursor = 0;

    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= total) break;
        if (aborted) throw new DOMException('Aborted', 'AbortError');
        const seg = segments[i];
        const enc = new Uint8Array(await gmFetchArrayBuffer(seg.url, headers));
        let plain = enc;
        if (useAES) {
          const iv = keyInfo.iv ? ivFromHex(keyInfo.iv) : ivFromSeq(seg.sn);
          plain = await aes128cbcDecrypt(keyBytes, iv, enc);
        }
        outTS[i] = plain;
        done++;
        bytesDownloaded += plain.byteLength;
        const percent = Math.round((done / total) * 100);
        if (done % 2 === 0 || percent >= 99) {
          report({ phase: 'downloading', done, total, percent, bytesDownloaded });
          await yieldToUI();
        }
      }
    }

    await Promise.all(Array(CONCURRENCY).fill(0).map(worker));

    // 讓 100% 與最後一筆下載進度先呈現
    report({ phase: 'downloading', done, total, percent: 100, bytesDownloaded });
    await yieldToUI();

    // ---- 合併並封裝為 MKV (ffmpeg.wasm) ----
    report({ phase: 'transmux', percent: 0 }); // 呼叫端會顯示「合併中...」
    await yieldToUI();

    // 將所有 TS 片段串接成單一 input.ts，避免在虛擬 FS 寫入大量小檔
    const totalBytes = outTS.reduce((s, x) => s + (x ? x.byteLength : 0), 0);
    const inputTS = new Uint8Array(totalBytes);
    for (let off = 0, i = 0; i < outTS.length; i++) {
      const part = outTS[i];
      inputTS.set(part, off);
      off += part.byteLength;
    }

    // 載入 ffmpeg.wasm
    const ffmpeg = await loadFFmpegWithFallback(report);

    // 寫入虛擬檔案系統
    ffmpeg.FS('writeFile', 'input.ts', inputTS);

    // 以「不重編碼（-c copy）」轉封裝為 Matroska（.mkv）
    // 若特定串流有時間戳不連續，可視情況加上 -copyts 或 -fflags +genpts（此處先不加，以保守設定為主）
    const outName = (String(fileName || 'video.mkv').toLowerCase().endsWith('.mkv')
      ? fileName
      : `${stripExt(fileName || 'video')}.mkv`);

    await ffmpeg.run(
      '-i', 'input.ts',
      '-c', 'copy',
      '-dn',                 // 丟棄資料流（teletext/metadata），避免相容性問題
      outName
    );

    report({ phase: 'finalize' }); // 仍顯示「合併中...」
    await yieldToUI();

    // 取回輸出
    const outData = ffmpeg.FS('readFile', outName);
    const blob = new Blob([outData.buffer], { type: 'video/x-matroska' });

    // 下載
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = outName;
    a.click();
    URL.revokeObjectURL(a.href);

    report({ phase: 'done', percent: 100, msg: '完成！' });
  }

  // 導出到全域 + 版本號
  if (typeof window !== 'undefined') {
    window.downloadHLSAsMKV = downloadHLSAsMKV;
    window.downloadHLSAsMKVVersion = DWHLS_VERSION;
  } else if (typeof self !== 'undefined') {
    self.downloadHLSAsMKV = downloadHLSAsMKV;
    self.downloadHLSAsMKVVersion = DWHLS_VERSION;
  }
  try { downloadHLSAsMKV.version = DWHLS_VERSION; } catch (_) {}

})();
