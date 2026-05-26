/**
 * 生成 Excel 可打开的 CSV 文件内容（带 UTF-8 BOM）
 */

function escapeCsvCell(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @param {Array<{url:string, price:string, status:string, fetchedAt:string, note?:string}>} rows
 * @returns {Buffer}
 */
function buildExcelCsv(rows) {
  const headers = ["序号", "竞品网址", "识别价格", "状态", "抓取时间", "备注"];
  const lines = [
    headers.join(","),
    ...rows.map((row, i) =>
      [
        i + 1,
        row.url,
        row.price || "—",
        row.status,
        row.fetchedAt,
        row.note || "",
      ]
        .map(escapeCsvCell)
        .join(",")
    ),
  ];
  const content = "\uFEFF" + lines.join("\r\n");
  return Buffer.from(content, "utf-8");
}

module.exports = { buildExcelCsv };
