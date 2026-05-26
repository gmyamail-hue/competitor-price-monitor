/**
 * 定时任务：每天北京时间 5:00 执行（Vercel Cron 使用 UTC 21:00）
 * 若未暂停 → 抓取所有监控网址 → 发邮件（Excel 附件）
 */

const { getState, setState } = require("../lib/storage");
const { fetchAndParsePrice } = require("../lib/parsePrice");
const { sendPriceReport } = require("../lib/email");

function beijingNowString() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization || req.headers.Authorization;
  return auth === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "方法不允许" });
  }

  if (!verifyCronAuth(req)) {
    return res.status(401).json({ ok: false, message: "未授权" });
  }

  try {
    const state = await getState();

    if (!state._storageReady) {
      return res.status(500).json({
        ok: false,
        message: "Redis 未配置，请在 Vercel 连接 Upstash Redis",
      });
    }

    // ========== 暂停机制：用户点了「暂停」后，定时任务直接跳过 ==========
    if (state.paused) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: "监控已暂停，未发送邮件",
        paused: true,
      });
    }

    if (!state.urls || state.urls.length === 0) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: "监控列表为空，未发送邮件",
      });
    }

    const fetchedAt = beijingNowString();
    const results = [];

    for (const url of state.urls) {
      const parsed = await fetchAndParsePrice(url);
      results.push({
        url,
        price: parsed.ok ? parsed.price : "",
        status: parsed.ok ? "成功" : "失败",
        fetchedAt,
        note: parsed.error || "",
      });
    }

    await sendPriceReport(results);

    const newState = {
      ...state,
      lastRunAt: fetchedAt,
      lastEmailAt: fetchedAt,
      lastResults: results,
    };
    await setState(newState);

    return res.status(200).json({
      ok: true,
      message: "邮件已发送",
      count: results.length,
      lastRunAt: fetchedAt,
    });
  } catch (err) {
    console.error("cron error:", err);
    const code = err.message;
    let message = "定时任务执行失败";

    if (code === "EMAIL_NOT_CONFIGURED") {
      message = "邮件未配置，请设置 RESEND_API_KEY、MAIL_FROM、MAIL_TO";
    } else if (code === "STORAGE_NOT_CONFIGURED") {
      message = "存储未配置，请连接 Upstash Redis";
    } else if (err.message) {
      message = err.message;
    }

    return res.status(500).json({ ok: false, message });
  }
};
