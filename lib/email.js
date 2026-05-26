/**
 * 通过 Resend 发送带 Excel（CSV）附件的邮件
 */

const { Resend } = require("resend");
const { buildExcelCsv } = require("./excel");

async function sendPriceReport(rows, options = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.env.MAIL_TO;

  if (!apiKey || !from || !to) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  const resend = new Resend(apiKey);
  const now = new Date();
  const dateStr = now.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  const subject = options.subject || `【竞品监控】${dateStr} 每日价格报表`;

  const csvBuffer = buildExcelCsv(rows);
  const fileName = `竞品价格监控_${dateStr.replace(/\//g, "")}.csv`;

  const successCount = rows.filter((r) => r.status === "成功").length;

  const htmlBody = `
    <div style="font-family: Microsoft YaHei, sans-serif; line-height: 1.6;">
      <h2>竞品价格每日报表</h2>
      <p>统计时间（北京时间）：${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
      <p>共监控 <strong>${rows.length}</strong> 个网址，成功识别 <strong>${successCount}</strong> 个。</p>
      <p>详细数据请查看附件 Excel 文件（.csv 格式，用 Excel / WPS 打开）。</p>
      <hr />
      <p style="color:#888;font-size:12px;">如需暂停每日邮件，请打开监控工具网页，在「自动邮件监控」处点击暂停。</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html: htmlBody,
    attachments: [
      {
        filename: fileName,
        content: csvBuffer,
      },
    ],
  });

  if (error) {
    throw new Error(error.message || "发送邮件失败");
  }

  return { fileName, to };
}

module.exports = { sendPriceReport };
