/**
 * 管理接口：查询状态、添加/删除网址、暂停/恢复、手动测试邮件
 * 写操作需要 ADMIN_PIN
 */

const { getState, setState } = require("../lib/storage");
const { fetchAndParsePrice } = require("../lib/parsePrice");
const { sendPriceReport } = require("../lib/email");

function beijingNowString() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function verifyPin(pin) {
  const expected = process.env.ADMIN_PIN;
  if (!expected) return false;
  return String(pin) === String(expected);
}

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const state = await getState();

    // ---------- 查询状态（无需密码）----------
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        storageReady: state._storageReady,
        paused: state.paused,
        urls: state.urls || [],
        lastRunAt: state.lastRunAt,
        lastEmailAt: state.lastEmailAt,
        lastResults: state.lastResults || [],
        schedule: "每天北京时间 05:00",
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, message: "方法不允许" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { action, pin, url } = body;

    if (!state._storageReady) {
      return res.status(500).json({
        ok: false,
        message: "Redis 未配置。请在 Vercel 项目里添加 Upstash Redis（见部署说明）",
      });
    }

    if (!verifyPin(pin)) {
      return res.status(403).json({ ok: false, message: "管理密码错误" });
    }

    // ---------- 暂停每日邮件 ----------
    if (action === "pause") {
      await setState({ ...state, paused: true });
      return res.status(200).json({
        ok: true,
        message: "已暂停：每天早上 5 点不会再发邮件",
        paused: true,
      });
    }

    // ---------- 恢复每日邮件 ----------
    if (action === "resume") {
      await setState({ ...state, paused: false });
      return res.status(200).json({
        ok: true,
        message: "已恢复：明天起继续每天 5 点发送邮件",
        paused: false,
      });
    }

    // ---------- 添加监控网址 ----------
    if (action === "addUrl") {
      const trimmed = (url || "").trim();
      if (!isValidUrl(trimmed)) {
        return res.status(400).json({ ok: false, message: "网址格式不正确" });
      }
      const urls = [...new Set([...(state.urls || []), trimmed])];
      await setState({ ...state, urls });
      return res.status(200).json({
        ok: true,
        message: "已加入每日监控",
        urls,
      });
    }

    // ---------- 删除监控网址 ----------
    if (action === "removeUrl") {
      const trimmed = (url || "").trim();
      const urls = (state.urls || []).filter((u) => u !== trimmed);
      await setState({ ...state, urls });
      return res.status(200).json({
        ok: true,
        message: "已移除",
        urls,
      });
    }

    // ---------- 立即发送一封测试邮件（不改动暂停状态）----------
    if (action === "testEmail") {
      if (!state.urls || state.urls.length === 0) {
        return res.status(400).json({ ok: false, message: "请先添加至少一个监控网址" });
      }

      const fetchedAt = beijingNowString();
      const results = [];
      for (const u of state.urls) {
        const parsed = await fetchAndParsePrice(u);
        results.push({
          url: u,
          price: parsed.ok ? parsed.price : "",
          status: parsed.ok ? "成功" : "失败",
          fetchedAt,
          note: parsed.error || "测试发送",
        });
      }

      await sendPriceReport(results, { subject: "【竞品监控】测试邮件" });

      await setState({
        ...state,
        lastRunAt: fetchedAt,
        lastEmailAt: fetchedAt,
        lastResults: results,
      });

      return res.status(200).json({
        ok: true,
        message: "测试邮件已发送，请查收邮箱（含 Excel 附件）",
      });
    }

    return res.status(400).json({ ok: false, message: "未知操作" });
  } catch (err) {
    console.error("config error:", err);
    let message = err.message || "操作失败";
    if (err.message === "EMAIL_NOT_CONFIGURED") {
      message = "邮件未配置，请先在 Vercel 设置 RESEND_API_KEY 等变量";
    }
    return res.status(500).json({ ok: false, message });
  }
};
