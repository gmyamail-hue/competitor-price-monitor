/**
 * 自动邮件监控：添加网址、暂停/恢复、测试邮件
 */

const pinInput = document.getElementById("pin-input");
const monitorUrlInput = document.getElementById("monitor-url-input");
const addMonitorBtn = document.getElementById("add-monitor-btn");
const pauseBtn = document.getElementById("pause-btn");
const resumeBtn = document.getElementById("resume-btn");
const testEmailBtn = document.getElementById("test-email-btn");
const statusBadge = document.getElementById("status-badge");
const statusDetail = document.getElementById("status-detail");
const monitorUrlList = document.getElementById("monitor-url-list");

/** 调用后端 API */
async function apiPost(action, extra = {}) {
  const pin = pinInput.value.trim();
  if (!pin) {
    alert("请先输入管理密码");
    pinInput.focus();
    return null;
  }

  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, pin, ...extra }),
  });

  const data = await res.json();
  if (!data.ok) {
    alert(data.message || "操作失败");
    return null;
  }
  return data;
}

/** 刷新页面上的监控状态 */
async function refreshMonitorStatus() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();

    if (!data.storageReady) {
      statusBadge.textContent = "未配置云端";
      statusBadge.className = "status-badge status-warn";
      statusDetail.textContent =
        "部署到 Vercel 并配置 Redis、邮件后，才能使用自动邮件功能。详见《部署说明.md》";
      monitorUrlList.innerHTML =
        '<li class="empty-tip">请先在 Vercel 完成环境配置</li>';
      return;
    }

    if (data.paused) {
      statusBadge.textContent = "已暂停";
      statusBadge.className = "status-badge status-paused";
      statusDetail.textContent = `每日 5 点邮件已停止。上次运行：${data.lastEmailAt || "暂无"}`;
      pauseBtn.disabled = true;
      resumeBtn.disabled = false;
    } else {
      statusBadge.textContent = "运行中";
      statusBadge.className = "status-badge status-active";
      statusDetail.textContent = `每天北京时间 05:00 发送邮件。上次：${data.lastEmailAt || "暂无"}`;
      pauseBtn.disabled = false;
      resumeBtn.disabled = true;
    }

    renderMonitorUrls(data.urls || []);
  } catch {
    statusBadge.textContent = "仅本地模式";
    statusBadge.className = "status-badge status-warn";
    statusDetail.textContent =
      "当前为本地打开，无后端 API。部署到 Vercel 后可使用自动邮件。";
  }
}

function renderMonitorUrls(urls) {
  if (!urls.length) {
    monitorUrlList.innerHTML = '<li class="empty-tip">暂无监控网址，请在下方添加</li>';
    return;
  }

  monitorUrlList.innerHTML = "";
  urls.forEach((url) => {
    const li = document.createElement("li");
    li.className = "monitor-url-item";
    li.innerHTML = `
      <span class="monitor-url-text">${escapeHtml(url)}</span>
      <button type="button" class="btn-remove" data-url="${escapeHtml(url)}">移除</button>
    `;
    li.querySelector(".btn-remove").addEventListener("click", async () => {
      if (!confirm("确定从每日监控中移除这个网址？")) return;
      await apiPost("removeUrl", { url });
      refreshMonitorStatus();
    });
    monitorUrlList.appendChild(li);
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

addMonitorBtn.addEventListener("click", async () => {
  const url = monitorUrlInput.value.trim();
  if (!url) {
    alert("请输入要监控的网址");
    return;
  }
  const data = await apiPost("addUrl", { url });
  if (data) {
    monitorUrlInput.value = "";
    alert(data.message);
    refreshMonitorStatus();
  }
});

pauseBtn.addEventListener("click", async () => {
  if (!confirm("确定暂停？暂停后每天早上 5 点不会再发邮件。")) return;
  const data = await apiPost("pause");
  if (data) {
    alert(data.message);
    refreshMonitorStatus();
  }
});

resumeBtn.addEventListener("click", async () => {
  const data = await apiPost("resume");
  if (data) {
    alert(data.message);
    refreshMonitorStatus();
  }
});

testEmailBtn.addEventListener("click", async () => {
  if (!confirm("立即发送一封测试邮件到你的邮箱？")) return;
  testEmailBtn.disabled = true;
  testEmailBtn.textContent = "发送中…";
  const data = await apiPost("testEmail");
  testEmailBtn.disabled = false;
  testEmailBtn.textContent = "立即发送测试邮件";
  if (data) {
    alert(data.message);
    refreshMonitorStatus();
  }
});

refreshMonitorStatus();
