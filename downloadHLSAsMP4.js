/* eslint-disable no-undef */
/*!
 * downloadHLSAsMP4.js
 * 將 HLS (m3u8) 以純 JS 下載（支援 AES-128）並用 mux.js 轉封裝(MP4 transmux)
 * Author: extracted & refactored from XPRAMT’s userscript logic
 * License: MIT
 */
(function (global) {
  'use strict';

  /**
   * 主函式：下載 HLS 為 MP4（包含：master/media m3u8 解析、TS 下載、AES-128 解密、mux.js 轉封裝）
   * @param {Object} options
   * @param {string} options.m3u8Url  Master 或 Media 的 m3u8 URL
   * @param {Object} [options.headers]  下載時要加的 HTTP 標頭（Userscript 環境可含 Referer/Origin）
   * @param {Object} [options.hearder]  同上，為相容舊拼字
   * @param {string} [options.fileName='video.mp4'] 輸出檔名
   * @param {boolean} [options.autoDownload=true]  是否自動觸發下載
   * @param {number} [options.concurrency=8]  同時下載切片數
   * @param {(p:Progress)=>void} [options.onProgress]  進度回呼：每完成一片段或進入新階段會呼叫
   * @param {(msg:string)=>void} [options.onStatus]  狀態訊息回呼（文字）
   * @param {AbortSignal} [options.signal]  可中止（AbortController.signal）
   * @param {string[]} [options.muxCdnCandidates]  自動載入 mux.js 的 CDN 候選
   * @returns {Promise<{blob: Blob, fileName: string, save: ()=>void}>}
   */
  async function downloadHLSAsMP4(options) {
    const {
      m3u8Url,
      fileName = 'video.mp4',
      autoDownload = true,
      concurrency = 8,
      onProgress = () => {},
      onStatus = () => {},
      signal,
      muxCdnCandidates = [
        'https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.min.js',
        'https://unpkg.com/mux.js@6.3.0/dist/mux.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/mux.js/6.3.0/mux.min.js'
      ]
    } = options || {};

    if (!m3u8Url) throw new Error('缺少 m3u8Url');

    // header 拼字相容
    const headers = Object.assign({}, options?.headers || {}, options?.hearder || {});

    // ===== 基礎工具 =====
    const gmAvailable = typeof GM_xmlhttpRequest === 'function';

    const gmLikeFetchText = (url) => requestWithFallback(url, 'text');
    const gmLikeFetchArrayBuffer = (url) => requestWithFallback(url, 'arraybuffer');

    function requestWithFallback(url, type) {
      if (signal?.aborted) return Promise.reject(new Error('已中止'));
      if (gmAvailable) {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers,
            responseType: type,
            onload: res => {
              if (type === 'text') resolve(res.responseText);
              else resolve(res.response);
            },
            onerror: err => reject(new Error(`請求失敗：${url}`)),
            ontimeout: () => reject(new Error(`請求逾時：${url}`))
          });
        });
      } else {
        // 原生 fetch（受 CORS 限制，且無法自訂 Referer/Origin）
        const controller = new AbortController();
        if (signal) {
          if (signal.aborted) throw new Error('已中止');
          signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return fetch(url, { method: 'GET', headers, mode: 'cors', signal: controller.signal })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
            if (type === 'text') return res.text();
            return res.arrayBuffer();
          });
      }
    }

    function toAbs(u, base) {
      try { return new URL(u, base).href; } catch { return u; }
    }

    // ===== 解析 Master / Media m3u8 =====
    function parseMasterM3U8(text, base) {
      // 解析 #EXT-X-STREAM-INF：挑最高畫質
      const lines = text.trim().split(/\r?\n/);
      const variants = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (l.startsWith('#EXT-X-STREAM-INF')) {
          const attrs = parseAttributeList(l.split(':')[1] || '');
          const uri = toAbs(lines[i + 1]?.trim(), base);
          const res = parseResolution(attrs.RESOLUTION);
          const bw = parseInt(attrs.BANDWIDTH || '0', 10) || 0;
          variants.push({ uri, resolution: res, bandwidth: bw, raw: attrs });
        }
      }
      return variants;
    }

    function parseResolution(resStr) {
      if (!resStr) return { width: 0, height: 0 };
      const m = String(resStr).match(/(\d+)\s*x\s*(\d+)/i);
      return m ? { width: +m[1], height: +m[2] } : { width: 0, height: 0 };
    }

    function parseAttributeList(s) {
      const out = {};
      (s || '').split(',').forEach(kv => {
        const [k, v] = kv.split('=');
        if (!k) return;
        out[k.trim()] = v ? v.trim().replace(/^"|"$/g, '') : '';
      });
      return out;
    }

    function parseMediaM3U8(text, base) {
      const lines = text.trim().split(/\r?\n/);
      const segments = [];
      let seq = 0, keyInfo = null, hasFMP4 = false;

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;

        if (l.startsWith('#EXT-X-MAP') && l.includes('URI=')) {
          // 有 MAP 代表多半是 fMP4
          hasFMP4 = true;
        } else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
          seq = parseInt(l.split(':')[1], 10) || 0;
        } else if (l.startsWith('#EXT-X-KEY')) {
          const raw = l.slice(l.indexOf(':') + 1);
          const attrs = parseAttributeList(raw);
          keyInfo = {
            method: attrs.METHOD,
            uri: attrs.URI ? toAbs(attrs.URI, base) : null,
            iv: attrs.IV || null
          };
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

    // ===== 進度/狀態 =====
    function reportProgress(patch) {
      // phase: 'prepare' | 'master' | 'downloading' | 'transmux' | 'finalize'
      // percent: 0~100
      onProgress(Object.assign({
        phase: 'prepare',
        done: 0, total: 0, percent: 0,
        bytesDownloaded: 0, lastBytes: 0
      }, patch));
    }

    const t0 = Date.now();
    onStatus('初始化… (initialize)');

    // ===== 讀取 m3u8（若是 master 會自動選最高畫質）=====
    let mediaUrl = m3u8Url;
    const masterText = await gmLikeFetchText(m3u8Url);
    if (/EXT-X-STREAM-INF/.test(masterText)) {
      reportProgress({ phase: 'master', percent: 0 });
      onStatus('偵測到 Master m3u8，挑選最高畫質… (master playlist)');

      const variants = parseMasterM3U8(masterText, m3u8Url);
      if (!variants.length) throw new Error('Master m3u8 解析失敗，未找到變體串流 (variants)');

      // 以解析度高度優先，其次以頻寬
      variants.sort((a, b) => {
        const dh = (b.resolution?.height || 0) - (a.resolution?.height || 0);
        if (dh !== 0) return dh;
        return (b.bandwidth || 0) - (a.bandwidth || 0);
      });
      mediaUrl = variants[0].uri;
    }

    // ===== 讀取 Media m3u8 =====
    onStatus('讀取媒體播放清單… (media playlist)');
    const mediaText = (mediaUrl === m3u8Url && /#EXTINF:/.test(masterText))
      ? masterText
      : await gmLikeFetchText(mediaUrl);

    const { segments, keyInfo, hasFMP4 } = parseMediaM3U8(mediaText, mediaUrl);
    if (hasFMP4) throw new Error('偵測到 fMP4（.m4s）切片，當前流程僅支援 TS。');
    if (!segments.length) throw new Error('解析不到任何切片 (segments)。');

    // ===== 取金鑰（若為 AES-128）=====
    let keyBytes = null, useAES = false;
    if (keyInfo && keyInfo.method === 'AES-128' && keyInfo.uri) {
      onStatus('取得 AES-128 金鑰… (encryption key)');
      const keyBuf = await gmLikeFetchArrayBuffer(keyInfo.uri);
      keyBytes = new Uint8Array(keyBuf);
      useAES = true;
    } else if (keyInfo && keyInfo.method && keyInfo.method !== 'NONE') {
      throw new Error('遇到非 AES-128 的加密（如 SAMPLE-AES/DRM），無法處理。');
    }

    // ===== 下載切片（並行）=====
    onStatus('開始下載切片… (download segments)');
    reportProgress({ phase: 'downloading', done: 0, total: segments.length, percent: 0 });

    const total = segments.length;
    const outTS = new Array(total);
    let done = 0;
    let bytesDownloaded = 0;

    let cursor = 0;
    const CONCURRENCY = Math.max(1, Number(concurrency) || 8);

    async function worker() {
      while (true) {
        if (signal?.aborted) throw new Error('已中止');
        const i = cursor++;
        if (i >= total) break;

        const seg = segments[i];
        const enc = new Uint8Array(await gmLikeFetchArrayBuffer(seg.url));
        let plain = enc;

        if (useAES) {
          const iv = keyInfo.iv ? ivFromHex(keyInfo.iv) : ivFromSeq(seg.sn);
          plain = await aes128cbcDecrypt(keyBytes, iv, enc);
        }

        outTS[i] = plain;
        done++;
        bytesDownloaded += plain.byteLength;

        reportProgress({
          phase: 'downloading',
          done,
          total,
          percent: Math.round(done / total * 100),
          bytesDownloaded,
          lastBytes: plain.byteLength
        });
      }
    }

    const workers = Array(CONCURRENCY).fill(0).map(worker);
    await Promise.all(workers);

    // ===== 確保 mux.js 可用 =====
    onStatus('載入/檢查 mux.js… (transmux library)');
    await ensureMuxJS(muxCdnCandidates);

    const MUX = (typeof muxjs !== 'undefined') ? muxjs
              : (typeof global !== 'undefined' && global.muxjs ? global.muxjs : null);

    const TransmuxerClass =
      (MUX && MUX.Transmuxer) ||
      (MUX && MUX.mp4 && MUX.mp4.Transmuxer) ||
      (MUX && MUX.flv && MUX.flv.Transmuxer) ||
      (MUX && MUX.partial && MUX.partial.Transmuxer);

    if (!MUX || !TransmuxerClass) {
      throw new Error('mux.js 已載入，但未找到 Transmuxer 類別。');
    }

    // ===== TS → MP4 (transmux) =====
    onStatus('轉封裝為 MP4… (transmux to MP4)');
    reportProgress({ phase: 'transmux', percent: 0 });

    const transmuxer = new TransmuxerClass({ keepOriginalTimestamps: true });
    const mp4Parts = [];

    transmuxer.on('data', (segment) => {
      if (segment.initSegment) mp4Parts.push(segment.initSegment);
      if (segment.data) mp4Parts.push(segment.data);
    });

    await new Promise(resolve => {
      transmuxer.on('done', resolve);
      for (const ts of outTS) transmuxer.push(ts);
      transmuxer.flush();
    });

    reportProgress({ phase: 'finalize', percent: 100 });
    onStatus(`完成，耗時 ${(Date.now() - t0) / 1000 | 0}s。`);

    const blob = new Blob(mp4Parts, { type: 'video/mp4' });
    const safeName = ensureMP4Name(fileName);

    function save() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = safeName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    if (autoDownload) save();

    return { blob, fileName: safeName, save };
  }

  // ===== 輔助：安全檔名與 mux.js 載入 =====
  function ensureMP4Name(name) {
    const n = name || 'video.mp4';
    const fullwidthMap = {
      '<':'＜','>':'＞',':':'：','"':'＂','/':'／','\\':'＼','|':'｜','?':'？','!':'！','*':'＊'
    };
    const base = n.replace(/[\/\\<>:"*|?!]/g, ch => fullwidthMap[ch] || '_');
    return base.toLowerCase().endsWith('.mp4') ? base : (base + '.mp4');
  }

  function ensureMuxLoaded() {
    return (typeof muxjs !== 'undefined') ||
           (typeof self !== 'undefined' && typeof self.muxjs !== 'undefined');
  }

  function ensureMuxJS(candidates) {
    if (ensureMuxLoaded()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let idx = 0;
      const tryNext = () => {
        if (idx >= candidates.length) {
          reject(new Error('mux.js 載入失敗（所有 CDN 候選皆無法載入）'));
          return;
        }
        const src = candidates[idx++];
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.onload = () => (ensureMuxLoaded() ? resolve() : tryNext());
        s.onerror = () => tryNext();
        document.head.appendChild(s);
      };
      tryNext();
    });
  }

  // 匯出到全域（UMD 風格的一半；瀏覽器情境）
  global.downloadHLSAsMP4 = downloadHLSAsMP4;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));

/**
 * @typedef {Object} Progress
 * @property {'prepare'|'master'|'downloading'|'transmux'|'finalize'} phase - 階段（phase）
 * @property {number} done - 已完成段數
 * @property {number} total - 總段數
 * @property {number} percent - 百分比（四捨五入到整數）
 * @property {number} bytesDownloaded - 已下載位元組
 * @property {number} lastBytes - 最新完成的段落位元組
 */
