/**
 * 竞品官网价格监控工具
 * 功能：粘贴网页 HTML 源码 → 自动识别价格 → 导出 Excel（CSV）
 */

// ========== 页面元素 ==========
const urlInput = document.getElementById("url-input");
const htmlInput = document.getElementById("html-input");
const startBtn = document.getElementById("start-btn");
const exportBtn = document.getElementById("export-btn");
const loadingEl = document.getElementById("loading");
const resultSection = document.getElementById("result-section");
const resultLink = document.getElementById("result-link");
const resultPrice = document.getElementById("result-price");
const resultTime = document.getElementById("result-time");
const resultNote = document.getElementById("result-note");
const candidatesSection = document.getElementById("candidates-section");
const candidatesList = document.getElementById("candidates-list");
const historyList = document.getElementById("history-list");

// ========== 内存中的历史记录（用于导出 Excel）==========
// 每条记录格式：{ url, price, fetchedAt, source }
let historyRecords = [];

// 当前这次解析的完整信息（方便切换候选价格时更新）
let currentParse = null;

// ========== 常见「价格」相关的 HTML 特征词 ==========
const PRICE_HINT_WORDS = [
  "price", "Price", "PRICE",
  "amount", "money", "cost",
  "售价", "价格", "现价", "原价", "促销",
];

// ========== 用正则匹配文本里的价格 ==========
// 支持：¥99、￥1,299.00、$19.99、199元、1999.00 等
const PRICE_REGEX =
  /(?:¥|￥|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:元|块|RMB|CNY)/gi;

/**
 * 校验网址格式
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 获取当前时间的可读字符串
 */
function formatNow() {
  return new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 防止 XSS：把用户文本转成安全 HTML
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 判断一段文字是否「像价格」
 */
function looksLikePrice(text) {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  // 必须包含数字
  if (!/\d/.test(t)) return false;
  // 排除明显不是价格的（年份、电话、版本号等）
  if (/^\d{4}$/.test(t.replace(/,/g, ""))) return false;
  if (/1[3-9]\d{9}/.test(t)) return false;
  return /(?:¥|￥|\$|€|£|元|块|RMB|CNY)/i.test(t) || /^[\d,]+(\.\d{1,2})?$/.test(t);
}

/**
 * 给候选价格打分，分数越高越可能是「主价格」
 */
function scorePriceCandidate(text, contextHint) {
  let score = 0;
  const lower = text.toLowerCase();
  const ctx = (contextHint || "").toLowerCase();

  if (/(?:¥|￥|\$)/.test(text)) score += 30;
  if (/\.\d{2}/.test(text)) score += 10;
  if (PRICE_HINT_WORDS.some((w) => ctx.includes(w.toLowerCase()))) score += 40;

  // 价格通常在合理区间（1 元 ~ 999 万）
  const num = parseFloat(text.replace(/[^\d.]/g, ""));
  if (!isNaN(num)) {
    if (num >= 1 && num <= 9999999) score += 20;
    if (num >= 10 && num <= 500000) score += 10;
  }

  return score;
}

/**
 * 从 HTML 字符串中解析价格
 * @param {string} htmlString - 用户粘贴的网页源码
 * @returns {{ prices: string[], best: string, note: string }}
 */
function parsePriceFromHtml(htmlString) {
  const found = new Map(); // key=价格文本, value=最高分

  // 用浏览器内置解析器把 HTML 字符串变成可查询的文档树
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  // --- 方法 1：查找带 price 语义的标签属性 ---
  const attrSelectors = [
    "[data-price]",
    "[data-product-price]",
    "[itemprop='price']",
    "[class*='price' i]",
    "[id*='price' i]",
  ];

  for (const selector of attrSelectors) {
    try {
      doc.querySelectorAll(selector).forEach((el) => {
        const attrs = ["data-price", "data-product-price", "content", "value"];
        for (const attr of attrs) {
          const val = el.getAttribute(attr);
          if (val && looksLikePrice(val)) {
            const score = scorePriceCandidate(val, el.className + el.id);
            found.set(val.trim(), Math.max(found.get(val.trim()) || 0, score + 50));
          }
        }
        const text = el.textContent?.trim();
        if (text && looksLikePrice(text)) {
          const score = scorePriceCandidate(text, el.className + el.id);
          found.set(text, Math.max(found.get(text) || 0, score + 30));
        }
      });
    } catch {
      // 部分选择器旧浏览器不支持，忽略即可
    }
  }

  // --- 方法 2：扫描所有元素的可见文字 ---
  doc.querySelectorAll("body *").forEach((el) => {
    // 跳过 script/style，避免扫到 JS 里的数字
    const tag = el.tagName?.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return;

    const text = el.textContent?.trim();
    if (!text || text.length > 80) return;

    const matches = text.match(PRICE_REGEX);
    if (matches) {
      for (const m of matches) {
        const cleaned = m.trim();
        if (looksLikePrice(cleaned)) {
          const hint = (el.className || "") + (el.id || "") + (el.getAttribute("itemprop") || "");
          const score = scorePriceCandidate(cleaned, hint);
          found.set(cleaned, Math.max(found.get(cleaned) || 0, score));
        }
      }
    }
  });

  // --- 方法 3：对整个 HTML 原文再做一次正则（兜底）---
  const rawMatches = htmlString.match(PRICE_REGEX) || [];
  for (const m of rawMatches) {
    const cleaned = m.trim();
    if (looksLikePrice(cleaned)) {
      const score = scorePriceCandidate(cleaned, "raw");
      found.set(cleaned, Math.max(found.get(cleaned) || 0, score - 5));
    }
  }

  // 按分数排序
  const sorted = [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([price]) => price);

  if (sorted.length === 0) {
    return {
      prices: [],
      best: "",
      note: "未在源码中识别到价格，请确认粘贴的是商品页完整源码，或页面价格是否为图片展示。",
    };
  }

  const note =
    sorted.length === 1
      ? "※ 已从粘贴的网页源码中自动识别价格"
      : `※ 识别到 ${sorted.length} 个候选价格，已选用最可能的主价格（可点击下方切换）`;

  return { prices: sorted, best: sorted[0], note };
}

/**
 * 展示解析结果
 */
function showResult(url, price, fetchedAt, note, allPrices) {
  resultLink.href = url;
  resultLink.textContent = url;
  resultPrice.textContent = price;
  resultTime.textContent = fetchedAt;
  resultNote.textContent = note;
  resultSection.classList.remove("hidden");

  // 多个候选价格时显示可点击列表
  const others = (allPrices || []).filter((p) => p !== price);
  if (others.length > 0) {
    candidatesSection.classList.remove("hidden");
    candidatesList.innerHTML = "";
    others.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "candidate-btn";
      btn.textContent = p;
      btn.addEventListener("click", () => selectCandidatePrice(p));
      candidatesList.appendChild(btn);
    });
  } else {
    candidatesSection.classList.add("hidden");
  }
}

/**
 * 用户点击其他候选价格时切换
 */
function selectCandidatePrice(newPrice) {
  if (!currentParse) return;

  currentParse.price = newPrice;
  resultPrice.textContent = newPrice;

  // 同步更新历史里最新一条
  if (historyRecords.length > 0) {
    historyRecords[0].price = newPrice;
    refreshHistoryUI();
  }

  // 重新渲染候选按钮（把刚选中的换下去）
  showResult(
    currentParse.url,
    newPrice,
    currentParse.fetchedAt,
    currentParse.note,
    currentParse.allPrices
  );
}

/**
 * 写入历史记录
 */
function addToHistory(record) {
  historyRecords.unshift(record);
  refreshHistoryUI();
  exportBtn.disabled = false;
}

/**
 * 根据 historyRecords 重绘历史列表
 */
function refreshHistoryUI() {
  historyList.innerHTML = "";

  if (historyRecords.length === 0) {
    historyList.innerHTML =
      '<li class="empty-tip">暂无记录，完成一次解析后会出现在这里</li>';
    exportBtn.disabled = true;
    return;
  }

  historyRecords.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="history-item-url">${escapeHtml(item.url)}</span>
      <span class="history-item-meta">
        价格：<span class="history-item-price">${escapeHtml(item.price)}</span>
        &nbsp;|&nbsp; 时间：${escapeHtml(item.fetchedAt)}
        &nbsp;|&nbsp; ${escapeHtml(item.source)}
      </span>
    `;
    historyList.appendChild(li);
  });
}

/**
 * 加载状态开关
 */
function setLoading(isLoading) {
  if (isLoading) {
    loadingEl.classList.remove("hidden");
    startBtn.disabled = true;
    startBtn.textContent = "解析中…";
  } else {
    loadingEl.classList.add("hidden");
    startBtn.disabled = false;
    startBtn.textContent = "开始解析价格";
  }
}

/**
 * 主流程：校验 → 解析 HTML → 展示 → 记历史
 */
async function handleStartMonitor() {
  const url = urlInput.value.trim();
  const html = htmlInput.value.trim();

  if (!url) {
    alert("请先填写竞品网址");
    urlInput.focus();
    return;
  }
  if (!isValidUrl(url)) {
    alert("网址格式不正确，请以 https:// 或 http:// 开头");
    urlInput.focus();
    return;
  }
  if (!html) {
    alert("请粘贴网页源码到「② 粘贴网页源码」文本框\n\n操作：在竞品页按 Ctrl+U → 全选复制 → 粘贴到这里");
    htmlInput.focus();
    return;
  }

  setLoading(true);

  // 短暂延迟，让加载动画可见（解析本身是同步的）
  await new Promise((r) => setTimeout(r, 400));

  try {
    const { prices, best, note } = parsePriceFromHtml(html);

    if (!best) {
      alert(note);
      return;
    }

    const fetchedAt = formatNow();
    const record = {
      url,
      price: best,
      fetchedAt,
      source: "源码解析",
    };

    currentParse = {
      url,
      price: best,
      fetchedAt,
      note,
      allPrices: prices,
    };

    showResult(url, best, fetchedAt, note, prices);
    addToHistory(record);
  } catch (err) {
    alert("解析失败，请检查粘贴的内容是否为完整 HTML 源码");
    console.error(err);
  } finally {
    setLoading(false);
  }
}

/**
 * 导出 Excel：生成 UTF-8 带 BOM 的 CSV，Excel 可正确显示中文
 */
function exportToExcel() {
  if (historyRecords.length === 0) {
    alert("暂无数据可导出");
    return;
  }

  // CSV 表头
  const headers = ["序号", "竞品网址", "识别价格", "记录时间", "数据来源"];
  const rows = historyRecords.map((item, index) => [
    index + 1,
    item.url,
    item.price,
    item.fetchedAt,
    item.source,
  ]);

  // 把单元格里的特殊字符转义（逗号、引号、换行）
  function escapeCsvCell(value) {
    const str = String(value ?? "");
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const csvContent =
    "\uFEFF" + // BOM：让 Excel 识别 UTF-8 中文
    [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const fileName = `竞品价格监控_${dateStr}.csv`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

// ========== 事件绑定 ==========
startBtn.addEventListener("click", handleStartMonitor);
exportBtn.addEventListener("click", exportToExcel);

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") htmlInput.focus();
});
