/**
 * 从 HTML 字符串中识别价格（服务器端使用，逻辑与网页版一致）
 */

const PRICE_HINT_WORDS = [
  "price", "amount", "money", "cost",
  "售价", "价格", "现价", "原价", "促销",
];

const PRICE_REGEX =
  /(?:¥|￥|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:元|块|RMB|CNY)/gi;

function looksLikePrice(text) {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (!/\d/.test(t)) return false;
  if (/^\d{4}$/.test(t.replace(/,/g, ""))) return false;
  if (/1[3-9]\d{9}/.test(t)) return false;
  return /(?:¥|￥|\$|€|£|元|块|RMB|CNY)/i.test(t) || /^[\d,]+(\.\d{1,2})?$/.test(t);
}

function scorePriceCandidate(text, contextHint) {
  let score = 0;
  const ctx = (contextHint || "").toLowerCase();
  if (/(?:¥|￥|\$)/.test(text)) score += 30;
  if (/\.\d{2}/.test(text)) score += 10;
  if (PRICE_HINT_WORDS.some((w) => ctx.includes(w.toLowerCase()))) score += 40;
  const num = parseFloat(text.replace(/[^\d.]/g, ""));
  if (!isNaN(num) && num >= 1 && num <= 9999999) score += 20;
  return score;
}

/**
 * @param {string} htmlString
 * @returns {{ best: string, prices: string[] }}
 */
function parsePriceFromHtml(htmlString) {
  const found = new Map();

  // 从 HTML 属性里找 data-price 等
  const attrRegex =
    /(?:data-price|data-product-price|itemprop=["']price["'])\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRegex.exec(htmlString)) !== null) {
    const val = m[1].trim();
    if (looksLikePrice(val)) {
      found.set(val, Math.max(found.get(val) || 0, scorePriceCandidate(val, "attr") + 50));
    }
  }

  // 从 class/id 含 price 的片段附近找
  const blockRegex =
    /class=["'][^"']*price[^"']*["'][^>]*>([^<]{1,80})</gi;
  while ((m = blockRegex.exec(htmlString)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, "").trim();
    const matches = inner.match(PRICE_REGEX);
    if (matches) {
      for (const p of matches) {
        const cleaned = p.trim();
        if (looksLikePrice(cleaned)) {
          found.set(cleaned, Math.max(found.get(cleaned) || 0, scorePriceCandidate(cleaned, "price-class") + 35));
        }
      }
    }
  }

  // 全文正则兜底
  const rawMatches = htmlString.match(PRICE_REGEX) || [];
  for (const p of rawMatches) {
    const cleaned = p.trim();
    if (looksLikePrice(cleaned)) {
      found.set(cleaned, Math.max(found.get(cleaned) || 0, scorePriceCandidate(cleaned, "raw")));
    }
  }

  const sorted = [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([price]) => price);

  return { best: sorted[0] || "", prices: sorted };
}

/**
 * 访问网址并抓取 HTML，再解析价格
 * @param {string} url
 */
async function fetchAndParsePrice(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return { ok: false, price: "", error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const { best } = parsePriceFromHtml(html);

    if (!best) {
      return { ok: false, price: "", error: "未识别到价格（页面可能需登录或为动态加载）" };
    }

    return { ok: true, price: best, error: "" };
  } catch (err) {
    const msg = err.name === "AbortError" ? "请求超时" : err.message;
    return { ok: false, price: "", error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { parsePriceFromHtml, fetchAndParsePrice };
