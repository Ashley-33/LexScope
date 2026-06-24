// parse.js — 文件解析:把 .docx / .pdf / 图片 解析为纯文本
// 设计契约见 README;本文件不修改任何既有文件,仅对外导出 parseFile。
//
// 全部依赖通过浏览器原生动态 import() 从受信 CDN 拉取:
//   - mammoth (.docx) → cdn.jsdelivr.net
//   - pdfjs-dist (.pdf) → esm.sh
//   - tesseract.js (图片 OCR) → esm.sh
// 任何失败均 throw new Error('中文说明'),交由调用方 catch。

// 版本常量集中管理,确保主库与 worker 版本一致(pdf.js 尤其敏感)。
const PDFJS_VERSION = '4.8.69';
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
const TESSERACT_VERSION = '5.1.1';

/**
 * 解析用户上传的文件为纯文本。
 * @param {File} file 浏览器 File 对象
 * @param {(msg:string)=>void} [onProgress] 可选进度回调,用于在 UI 汇报阶段/进度
 * @returns {Promise<{ name:string, text:string }>}
 * @throws {Error} 不支持的类型 / 解析失败 / 提取为空,均抛出带中文说明的 Error
 */
export async function parseFile(file, onProgress) {
  if (!file) throw new Error('未提供文件');

  const report = (msg) => {
    try { if (typeof onProgress === 'function') onProgress(msg); } catch (_) { /* 进度回调异常不影响解析 */ }
  };

  const name = file.name || '';
  const lower = name.toLowerCase();
  const type = (file.type || '').toLowerCase();

  let text = '';

  if (lower.endsWith('.docx')) {
    text = await parseDocx(file, report);
  } else if (lower.endsWith('.pdf') || type === 'application/pdf') {
    text = await parsePdf(file, report);
  } else if (isImage(lower, type)) {
    text = await parseImage(file, report);
  } else {
    throw new Error('暂不支持的文件类型:' + name);
  }

  text = normalizeText(text);
  if (!text) throw new Error('未能从文件中提取到文本');

  return { name, text };
}

// 判断是否为受支持的图片类型
function isImage(lower, type) {
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp)$/.test(lower);
}

// ---------------- .docx ----------------
async function parseDocx(file, report) {
  report('正在加载 docx 解析组件…');
  let mammoth;
  try {
    // mammoth.browser 是 UMD,import 后挂载在 default 或全局;两种都兼容。
    const mod = await import(/* @vite-ignore */ MAMMOTH_URL);
    mammoth = mod && (mod.default || mod);
    if (!mammoth || typeof mammoth.extractRawText !== 'function') {
      // UMD 可能挂到全局 window.mammoth
      mammoth = (typeof window !== 'undefined' && window.mammoth) ? window.mammoth : mammoth;
    }
    if (!mammoth || typeof mammoth.extractRawText !== 'function') {
      throw new Error('mammoth 接口缺失');
    }
  } catch (e) {
    throw new Error('加载 Word(.docx)解析组件失败,请检查网络后重试:' + safeMsg(e));
  }

  report('正在解析 Word 文档…');
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result && result.value) ? result.value : '';
  } catch (e) {
    throw new Error('解析 Word 文档失败,文件可能已损坏或非有效 .docx:' + safeMsg(e));
  }
}

// ---------------- .pdf ----------------
async function parsePdf(file, report) {
  report('正在加载 PDF 解析组件…');
  let pdfjs;
  try {
    pdfjs = await import(/* @vite-ignore */ `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`);
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
      throw new Error('pdfjs 接口缺失');
    }
  } catch (e) {
    throw new Error('加载 PDF 解析组件失败,请检查网络后重试:' + safeMsg(e));
  }

  // worker 必须与主库同版本,否则 pdf.js 会报版本不匹配。
  try {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  } catch (_) { /* 个别环境无法设置 worker,pdf.js 会回退到主线程,忽略 */ }

  report('正在解析 PDF…');
  let pdf;
  try {
    const arrayBuffer = await file.arrayBuffer();
    // 注意:getDocument 接收的 data 会被转移,使用其副本视图。
    pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  } catch (e) {
    throw new Error('打开 PDF 失败,文件可能已加密或损坏:' + safeMsg(e));
  }

  try {
    const pages = [];
    const total = pdf.numPages || 0;
    for (let i = 1; i <= total; i++) {
      report(`正在解析 PDF 第 ${i}/${total} 页…`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items || [])
        .map((it) => (it && typeof it.str === 'string') ? it.str : '')
        .join('');
      pages.push(pageText);
      // 主动释放页面资源,避免大文档内存占用过高。
      try { page.cleanup(); } catch (_) { /* 忽略 */ }
    }
    // 页间以换行分隔
    return pages.join('\n');
  } catch (e) {
    throw new Error('提取 PDF 文本失败:' + safeMsg(e));
  } finally {
    try { await pdf.destroy(); } catch (_) { /* 忽略 */ }
  }
}

// ---------------- 图片 OCR ----------------
async function parseImage(file, report) {
  report('正在加载 OCR 组件(首次较慢)…');
  let Tesseract;
  try {
    const mod = await import(/* @vite-ignore */ `https://esm.sh/tesseract.js@${TESSERACT_VERSION}`);
    Tesseract = mod && (mod.default || mod);
    if (!Tesseract || typeof Tesseract.recognize !== 'function') {
      throw new Error('tesseract 接口缺失');
    }
  } catch (e) {
    throw new Error('加载 OCR(图片识别)组件失败,请检查网络后重试:' + safeMsg(e));
  }

  report('正在 OCR 识别图片中的文字(中文+英文,可能耗时较久)…');
  try {
    const { data } = await Tesseract.recognize(file, 'chi_sim+eng', {
      logger: (m) => {
        // tesseract 的 logger 会持续上报 status / progress
        if (!m) return;
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          report(`OCR 识别中… ${Math.round(m.progress * 100)}%`);
        } else if (m.status) {
          report('OCR:' + m.status);
        }
      },
    });
    return (data && typeof data.text === 'string') ? data.text : '';
  } catch (e) {
    throw new Error('OCR 识别失败,请确认图片清晰且包含文字:' + safeMsg(e));
  }
}

// ---------------- 工具函数 ----------------

// 规整空白:统一换行符、去除行尾空白、折叠 3+ 连续空行为 1 个空行、整体 trim。
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n?/g, '\n')        // 统一换行
    .replace(/[ \t ]+\n/g, '\n') // 去行尾空白(含不间断空格)
    .replace(/\n{3,}/g, '\n\n')     // 折叠多余空行
    .trim();
}

// 从异常对象中安全取出可读信息,避免把 [object Object] 抛给用户。
function safeMsg(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  if (e.message) return e.message;
  try { return String(e); } catch (_) { return '未知错误'; }
}
