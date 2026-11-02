const state = {
  route: [],
  modules: null,
  dashboard: null,
  practiceFilters: { module_id: "", kp_id: "", difficulty: "", type: "", q: "", state: "" },
  practiceSelected: null,
  acmLanguage: { python: "python", cpp: "cpp" },
  acmCode: {},
  acmResult: {},
  mindmapZoom: 1,
  mindmapData: null,
  noteSelected: null,
  noteSearch: "",
  interviewDraft: {},
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const QUESTION_TYPE_LABELS = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  true_false: "判断题",
  fill_blank: "填空题",
  code_reading: "代码阅读",
  output_prediction: "输出预测",
  code_fix: "代码纠错",
  acm: "编程题",
  test_case_design: "测试用例设计",
  test_plan: "测试方案设计",
  interview: "面试简答",
  scenario: "综合场景",
};

function questionTypeLabel(type) {
  return QUESTION_TYPE_LABELS[type] || type || "未分类";
}

function questionDisplayTitle(title) {
  return String(title ?? "").replace(/^ACM\s*[：:]\s*/i, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function attr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(text) {
  const source = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const output = [];
  let inCode = false;
  let codeLines = [];
  let listOpen = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        if (listOpen) {
          output.push("</ul>");
          listOpen = false;
        }
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      if (listOpen) {
        output.push("</ul>");
        listOpen = false;
      }
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      if (listOpen) {
        output.push("</ul>");
        listOpen = false;
      }
      const level = Math.min(3, heading[1].length);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        output.push("<ul>");
        listOpen = true;
      }
      output.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    if (listOpen) {
      output.push("</ul>");
      listOpen = false;
    }
    if (/^\s*>\s?/.test(line)) {
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
    } else {
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  if (listOpen) output.push("</ul>");
  return output.join("");
}

function formatDate(value, withTime = false) {
  if (!value) return "";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function localDateIso() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function showToast(message, type = "") {
  const region = $("#toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  region.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`服务返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

function pageHead(title, description, actions = "") {
  return `
    <header class="page-head">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="page-actions">${actions}</div>
    </header>
  `;
}

function setLoading(text = "正在读取本地学习记录") {
  $("#view").innerHTML = `<div class="loading-block"><span class="spinner"></span><p>${escapeHtml(text)}</p></div>`;
}

function setNav(root) {
  $$("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === root);
  });
}

function closeMenu() {
  document.body.classList.remove("menu-open");
}

function openModal(title, body, wide = false) {
  $("#modal-root").innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${attr(title)}" data-modal-panel>
        <header class="modal-head">
          <h2>${escapeHtml(title)}</h2>
          <button class="btn small ghost" type="button" data-action="close-modal">关闭</button>
        </header>
        <div class="modal-body">${body}</div>
      </section>
    </div>
  `;
  const first = $("#modal-root input, #modal-root textarea, #modal-root select, #modal-root button");
  first?.focus();
}

function closeModal() {
  $("#modal-root").innerHTML = "";
}

function download(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadModules(force = false) {
  if (!state.modules || force) {
    state.modules = (await api("/api/modules")).modules;
  }
  return state.modules;
}

async function checkHealth() {
  try {
    const health = await api("/api/health");
    const node = $("#service-state");
    node.className = "service-state online";
    const cloudConnected = ["wandbox", "netlify-static"].includes(health.judge?.mode);
    node.innerHTML = `<i></i> ${cloudConnected ? "云端记录已连接" : health.judge?.mode === "wandbox-browser" ? "在线学习版已连接" : "本地记录已连接"}`;
    if (["wandbox", "wandbox-browser"].includes(health.judge?.mode)) {
      environmentWarning = "在线判题由 Wandbox 免费服务执行；仅用于个人练习，不上传敏感或公司源码。";
    }
    if (health.judge?.available) {
      node.title = `${health.judge.label}：${health.judge.warning}`;
    } else {
      node.title = health.judge?.warning || "代码评测未配置";
    }
    return health;
  } catch (error) {
    const node = $("#service-state");
    node.className = "service-state offline";
    node.innerHTML = `<i></i> 服务异常`;
    node.title = error.message;
    return null;
  }
}

function moduleLevel(module) {
  return module.display_level || "未入门";
}

async function renderDashboard() {
  setNav("dashboard");
  const data = await api("/api/dashboard");
  state.dashboard = data;
  const readiness = data.readiness;
  const tasks = data.today_tasks;
  const completion = tasks.total ? Math.round((tasks.completed / tasks.total) * 100) : 0;
  const phaseTitle = data.phase?.title || "计划尚未开始";
  const phaseTheme = data.phase?.theme || "完成准备后开始第一阶段。";
  const passedCriteria = readiness.criteria.filter((item) => item.passed).length;
  const knowledgePoints = [...new Map(tasks.tasks.filter((task) => task.kp_id).map((task) => [
    task.kp_id,
    { id: task.kp_id, title: task.kp_title || task.type },
  ])).values()];
  const moduleRows = data.modules.map((module) => `
    <a class="module-line" href="#/modules/${attr(module.module_id)}" style="--module-color:${attr(module.color)};text-decoration:none">
      <span class="module-marker"></span>
      <div>
        <strong>${escapeHtml(module.short_title)}</strong>
        <small>${module.correct_questions}/${module.distinct_questions} 题 · ${percent(module.accuracy)} 正确率</small>
      </div>
      <span class="level-tag" data-level="${attr(moduleLevel(module))}">${escapeHtml(moduleLevel(module))}</span>
    </a>
  `).join("");
  const weak = data.weak_points.length ? data.weak_points.map((item) => `
    <div class="weak-item">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.short_title)} · 已答题 ${item.attempts} 次</small>
      </div>
      <div>
        <div class="mini-meter"><span style="width:${Math.round(item.accuracy * 100)}%"></span></div>
        <small>${percent(item.accuracy)}</small>
      </div>
    </div>
  `).join("") : `<div class="empty-state"><strong>暂无薄弱项数据</strong>完成答题后，系统会按真实正确率识别。</div>`;
  $("#view").innerHTML = `
    <section class="dashboard-hero">
      <div class="hero-main">
        <div class="hero-overline"><b>${escapeHtml(phaseTitle)}</b><span>${escapeHtml(phaseTheme)}</span><span>距目标 ${data.days_to_target} 天</span></div>
        <h1>先让今天留下真实记录。</h1>
        <p>系统已按当前阶段、薄弱点与到期复习安排了 ${tasks.total} 道任务。完成情况会直接影响后续计划与掌握度，不使用虚构进度。</p>
        ${knowledgePoints.length ? `
          <div class="hero-knowledge">
            <div class="hero-knowledge-heading">
              <strong>今日 ${tasks.total} 题涉及的知识点</strong>
              <span>熟悉这些知识点就可以开始做题了</span>
            </div>
            <div class="hero-topic-list">
              ${knowledgePoints.map((point) => `<button class="hero-topic" type="button" data-action="open-kp" data-id="${attr(point.id)}">${escapeHtml(point.title)}</button>`).join("")}
            </div>
          </div>
        ` : ""}
        <div class="hero-actions">
          <a class="btn orange" href="#/daily">开始今日任务</a>
          <span><strong>${tasks.total}</strong> 道任务</span>
          <span>已完成 <strong>${tasks.completed}</strong></span>
        </div>
      </div>
      <div class="hero-score">
        <span class="score-kicker">转岗准备度</span>
        <div class="score-orbit" style="--score:${readiness.score}">
          <div><strong>${readiness.score}</strong><span>/ 100</span></div>
        </div>
        <div class="score-caption">
          <strong>${escapeHtml(readiness.label)}</strong>
          <small>${passedCriteria}/${readiness.criteria.length} 项门槛已达标</small>
        </div>
        <div class="readiness-segments" aria-label="${passedCriteria} 项能力门槛已达标">
          ${readiness.criteria.map((item) => `<span class="${item.passed ? "passed" : ""}" title="${attr(item.title)}"></span>`).join("")}
        </div>
        <small class="score-footnote">依据真实学习与项目证据计算</small>
      </div>
    </section>
    <section class="stats-line">
      <div class="stat-cell"><strong>${tasks.completed}/${tasks.total}</strong><span><b>今日完成</b><small>目标 ${tasks.target} 道</small></span></div>
      <div class="stat-cell"><strong>${data.streak}</strong><span><b>连续学习</b><small>按真实答题日</small></span></div>
      <div class="stat-cell"><strong>${data.due_reviews}</strong><span><b>到期复习</b><small>需要及时处理</small></span></div>
      <div class="stat-cell"><strong>${data.total_accepted}</strong><span><b>Accepted 提交</b><small>不是唯一进度</small></span></div>
    </section>
    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <section class="panel">
          <header class="panel-head">
            <h2>今日学习进度</h2>
            <span class="spacer"></span>
            <a class="text-link" href="#/daily">继续今日学习</a>
          </header>
          <div class="panel-body">
            <div class="progress-line"><span style="width:${completion}%"></span></div>
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>模块掌握度</h2><small class="spacer">晋级以独立作答为准</small><a class="text-link" href="#/modules">查看差距</a></header>
          <div class="module-list">${moduleRows}</div>
        </section>
      </div>
      <aside class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>当前薄弱点</h2></header>
          <div class="panel-body"><div class="weak-list">${weak}</div></div>
        </section>
      </aside>
    </div>
  `;
  const navDue = $("#nav-due");
  navDue.hidden = !data.due_reviews;
  navDue.textContent = data.due_reviews > 99 ? "99+" : data.due_reviews;
}

function questionOptions(q) {
  const type = q.type;
  if (["single_choice", "multiple_choice", "code_fix"].includes(type) && q.options?.length) {
    return q.options.map((option) => `
      <label class="option-row">
        <input type="${type === "multiple_choice" ? "checkbox" : "radio"}" name="answer" value="${attr(option.key)}">
        <span class="option-key">${escapeHtml(option.key)}</span>
        <span>${renderMarkdown(option.text)}</span>
      </label>
    `).join("");
  }
  if (type === "true_false") {
    return ["正确", "错误"].map((value) => `
      <label class="option-row">
        <input type="radio" name="answer" value="${value}">
        <span class="option-key">${value === "正确" ? "T" : "F"}</span>
        <span>${value}</span>
      </label>
    `).join("");
  }
  if (["test_case_design", "test_plan", "interview", "scenario"].includes(type)) {
    return `<label class="form-field"><span class="field-label">你的回答与评分要点</span><textarea name="answer" rows="8" placeholder="写出前置条件、步骤、预期结果或技术答案。保存后请按评分标准自评。"></textarea></label>`;
  }
  return `<label class="form-field"><span class="field-label">填写答案</span><input type="text" name="answer" autocomplete="off" placeholder="输入结果或表达式"></label>`;
}

function questionPanel(q, context = {}) {
  const isAcm = q.type === "acm";
  const manageable = q.source_type.startsWith("AI ") || ["本地模板生成", "用户导入"].includes(q.source_type);
  const nextAction = context.daily
    ? context.nextTask
      ? `<button class="btn next-question daily-next-action" type="button" data-action="next-daily-task" data-id="${attr(context.nextTask.question_id)}" data-task-id="${attr(context.nextTask.id)}" data-kind="${attr(context.nextTask.kind)}" aria-label="下一题：${attr(context.nextTask.title)}">下一题</button>`
      : `<button class="btn next-question daily-next-action" type="button" disabled>已是最后一题</button>`
    : "";
  return `
    <article class="panel question-shell" id="question-shell">
      <div class="panel-body">
        <div class="question-meta">
          <span class="pill orange">${escapeHtml(questionTypeLabel(q.type))}</span>
          <span class="pill">${escapeHtml(q.difficulty)}</span>
          <span class="pill">${escapeHtml(q.module_id)}</span>
          <span class="pill">${escapeHtml(q.source_type)}</span>
          ${context.taskKind ? `<span class="pill">${context.taskKind === "review" ? "复习任务" : "新题任务"}</span>` : ""}
        </div>
        <h2 class="question-title">${escapeHtml(questionDisplayTitle(q.title))}</h2>
        <div class="question-stem">${renderMarkdown(q.stem)}</div>
        ${(q.data?.sources || []).length ? `<p>${q.data.sources.map((source) => `<a class="pill" href="${attr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>`).join(" ")}</p>` : ""}
        ${isAcm ? `
          <div class="notice info">${context.daily ? "这是今日任务中的编程题。" : "这是一道 ACM 模式题。"}请到代码编辑器完成 Python 或 C++17 提交，判题依据真实执行结果。</div>
          <div class="form-actions">
            <a class="btn primary" href="#/acm/${attr(q.id)}${context.taskId ? `?task=${context.taskId}&kind=${attr(context.taskKind || "")}` : ""}">${context.daily ? "继续编程任务" : "打开代码评测"}</a>
            ${nextAction}
          </div>
        ` : `
          <form data-form="answer" data-question-id="${attr(q.id)}">
            <input type="hidden" name="task_id" value="${attr(context.taskId || "")}">
            <input type="hidden" name="task_kind" value="${attr(context.taskKind || "")}">
            <div class="answer-area">${questionOptions(q)}</div>
            <div class="form-actions">
              <button class="btn primary" type="submit">提交答案</button>
              <button class="btn" type="button" data-action="reveal-question" data-id="${attr(q.id)}">先看提示</button>
              ${nextAction}
            </div>
          </form>
        `}
        ${manageable ? `<div class="form-actions" style="border-top:1px solid var(--line);padding-top:12px;margin-top:18px">
          <span class="pill">${escapeHtml(q.source_type)}</span>
          <button class="btn small" type="button" data-action="edit-question" data-id="${attr(q.id)}">编辑题目</button>
          <button class="btn small danger" type="button" data-action="delete-question" data-id="${attr(q.id)}" data-title="${attr(q.title)}">删除题目</button>
        </div>` : ""}
        <div id="answer-feedback"></div>
      </div>
    </article>
  `;
}

function answerResultHtml(result) {
  const statusClass = result.is_correct === true ? "correct" : result.is_correct === false ? "wrong" : "pending";
  const statusText = result.is_correct === true ? "回答通过" : result.is_correct === false ? "需要修正" : "等待自评";
  const answer = Array.isArray(result.correct_answer) ? result.correct_answer.join("；") : String(result.correct_answer ?? "");
  const notes = Object.entries(result.option_notes || {}).map(([key, text]) => `<li><strong>${escapeHtml(key)}</strong>：${escapeHtml(text)}</li>`).join("");
  const rubric = (result.rubric || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `
    <section class="feedback">
      <div class="feedback-status ${statusClass}">
        <span class="feedback-symbol">${result.is_correct === true ? "OK" : result.is_correct === false ? "!" : "?"}</span>
        <div><strong>${statusText}</strong><small>${escapeHtml(result.message || "")}</small></div>
      </div>
      ${result.is_correct === false ? `
        <div class="analysis-grid">
          <div class="analysis-box"><strong>先定位错误</strong><p>${escapeHtml(result.target || "对照题目考查目标，确认偏差发生在概念、边界还是表达。")}</p></div>
          <div class="analysis-box"><strong>常见易错点</strong><p>${escapeHtml(result.common_mistakes || "检查是否遗漏题目条件。")}</p></div>
        </div>
      ` : ""}
      ${result.is_correct !== null ? `<p><strong>参考答案：</strong>${escapeHtml(answer)}</p>` : ""}
      <p><strong>${escapeHtml(result.explanation_short || "")}</strong></p>
      <div class="markdown-body">${renderMarkdown(result.explanation || "")}</div>
      ${notes ? `<h3>选项辨析</h3><ul>${notes}</ul>` : ""}
      ${rubric ? `<h3>评分标准</h3><ul>${rubric}</ul>` : ""}
      ${result.review ? `<div class="notice">复习状态：${escapeHtml(result.review.status)}；下次复习 ${escapeHtml(result.review.due_date)}。</div>` : ""}
      ${result.explanation ? `<p><strong>应用场景：</strong>${escapeHtml(result.application || "")}</p>` : ""}
      ${result.next_action ? `<p><strong>下一步：</strong>${escapeHtml(result.next_action)}</p>` : ""}
      ${result.status === "manual_required" ? `
        <form data-form="self-review" data-attempt-id="${result.attempt_id}">
          <div class="form-row">
            <label class="form-field"><span class="field-label">对照评分标准自评（0–100）</span><input type="number" name="self_score" min="0" max="100" required></label>
            <label class="form-field"><span class="field-label">错误归类</span>
              <select name="error_category"><option>暂无明显错误</option><option>遗漏边界</option><option>方案不完整</option><option>表达不清</option><option>概念混淆</option></select>
            </label>
          </div>
          <label class="form-field"><span class="field-label">自评说明</span><textarea name="self_review" rows="3" placeholder="哪些要点做到了，哪些还没做到？"></textarea></label>
          <button class="btn primary" type="submit">保存自评</button>
        </form>
      ` : ""}
    </section>
  `;
}

async function renderDaily(selectedId = null, taskId = null, taskKind = null) {
  setNav("daily");
  const data = await api("/api/tasks");
  const activeId = selectedId || data.tasks.find((task) => !task.completed)?.question_id || data.tasks[0]?.question_id;
  const activeTask = data.tasks.find((task) => task.question_id === activeId);
  const activeIndex = data.tasks.findIndex((task) => task.question_id === activeId);
  const nextTask = activeIndex >= 0 ? data.tasks[activeIndex + 1] || null : null;
  let question = null;
  if (activeId) question = await api(`/api/questions/${encodeURIComponent(activeId)}`);
  $("#view").innerHTML = `
    ${pageHead("今日学习", `真实作答会被保存；修改每日目标只调整未完成任务，不删除已完成记录。`, `
      <button class="btn" type="button" data-action="rebuild-tasks">重新安排剩余任务</button>
      <a class="btn primary" href="#/reviews">处理复习队列</a>
    `)}
    ${data.shortage.length ? `<div class="notice error">${data.shortage.map(escapeHtml).join("<br>")}</div>` : ""}
    <div class="daily-workspace">
      <div class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>任务进度</h2><small class="spacer">${data.completed}/${data.total} 完成</small></header>
          <div class="panel-body">
            <div class="progress-line"><span style="width:${data.total ? (data.completed / data.total) * 100 : 0}%"></span></div>
          </div>
        </section>
        <div id="daily-question">${question ? questionPanel(question, {
          daily: true,
          taskId: activeTask?.id || taskId,
          taskKind: activeTask?.kind || taskKind,
          nextTask,
        }) : `<div class="empty-state"><strong>没有可安排的任务</strong>题库可能已全部完成，或今日任务已清空。</div>`}</div>
      </div>
    </div>
  `;
}

async function renderPractice(selectedId = null) {
  setNav("practice");
  const modules = await loadModules();
  const filters = state.practiceFilters;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const [list] = await Promise.all([api(`/api/questions?${params}`)]);
  const selected = selectedId || state.practiceSelected;
  let question = null;
  if (selected) {
    try {
      question = await api(`/api/questions/${encodeURIComponent(selected)}`);
    } catch {
      state.practiceSelected = null;
    }
  }
  const moduleOptions = modules.map((m) => `<option value="${attr(m.id)}" ${filters.module_id === m.id ? "selected" : ""}>${escapeHtml(m.short_title)}</option>`).join("");
  const types = ["single_choice", "multiple_choice", "true_false", "fill_blank", "code_reading", "output_prediction", "code_fix", "acm", "test_case_design", "test_plan", "interview", "scenario"];
  const typeOptions = types.map((type) => `<option value="${type}" ${filters.type === type ? "selected" : ""}>${questionTypeLabel(type)}</option>`).join("");
  const difficultyOptions = ["入门", "基础", "进阶", "精通"].map((value) => `<option ${filters.difficulty === value ? "selected" : ""}>${value}</option>`).join("");
  $("#view").innerHTML = `
    ${pageHead("专项刷题", `题库来自 SQLite，共 ${list.total} 道符合当前筛选。所有编程题只提供 Python 与 C++17 ACM 模式。`, `
      <button class="btn" type="button" data-action="open-ai-generator">动态出题</button>
      <button class="btn" type="button" data-action="open-question-import">导入单题</button>
    `)}
    <form class="filter-bar" data-form="practice-filter">
      <input class="wide" type="text" name="q" value="${attr(filters.q)}" placeholder="搜索题干或标题">
      <select name="module_id"><option value="">全部模块</option>${moduleOptions}</select>
      <select name="difficulty"><option value="">全部难度</option>${difficultyOptions}</select>
      <select name="type"><option value="">全部题型</option>${typeOptions}</select>
      <select name="state"><option value="">全部状态</option><option value="unattempted" ${filters.state === "unattempted" ? "selected" : ""}>未作答</option><option value="wrong" ${filters.state === "wrong" ? "selected" : ""}>错题复习中</option></select>
      <button class="btn primary" type="submit">筛选</button>
    </form>
    <div class="split-view">
      <section class="panel">
        <header class="panel-head"><h2>题目清单</h2><small class="spacer">${list.total} 道</small></header>
        <div class="question-list">
          ${list.questions.length ? list.questions.map((q) => `
            <div class="question-list-row ${selected === q.id ? "active" : ""}" data-action="select-practice" data-id="${attr(q.id)}" tabindex="0" role="button">
              <span class="module-marker" style="--module-color:${attr(q.module_color)}"></span>
              <div>
                <h3>${escapeHtml(q.title)}</h3>
                <p>${escapeHtml(q.module_title)} · ${escapeHtml(q.kp_title)} · ${escapeHtml(questionTypeLabel(q.type))} · ${escapeHtml(q.difficulty)}</p>
              </div>
              <span class="pill">${q.validation_status.includes("待") ? "待确认" : "已校验"}</span>
            </div>
          `).join("") : `<div class="empty-state"><strong>没有匹配题目</strong>调整筛选条件后再试。</div>`}
        </div>
      </section>
      <div>
        ${question ? questionPanel(question) : `<section class="panel"><div class="empty-state"><strong>选择一道题开始</strong>左侧列表包含种子题、本地动态题、远程题和用户导入题。</div></section>`}
      </div>
    </div>
  `;
}

function defaultCode(language) {
  if (language === "cpp") {
    return `#include <iostream>\n\nint main() {\n    std::ios::sync_with_stdio(false);\n    std::cin.tie(nullptr);\n\n    // 从标准输入读取数据\n\n    return 0;\n}\n`;
  }
  return `# 从标准输入读取数据\n# 向标准输出打印结果\n\n`;
}

function judgeHtml(result) {
  if (!result) {
    return `<div class="judge-console"><div class="judge-status"><span class="judge-badge">READY</span><span>运行样例或提交后显示真实评测结果</span></div></div>`;
  }
  const ok = result.status === "ACCEPTED" || result.status === "CUSTOM_RUN";
  return `
    <div class="judge-console" id="judge-console">
      <div class="judge-status">
        <span class="judge-badge ${ok ? "accepted" : "failed"}">${escapeHtml(result.status)}</span>
        <span>${result.passed}/${result.total} 测试 · ${result.runtime_ms ?? 0} ms</span>
        <span style="margin-left:auto;color:#90a49a">${escapeHtml(result.mode || "")}</span>
      </div>
      <p>${escapeHtml(result.message || "")}</p>
      ${result.compile_output ? `<h3>编译输出</h3><pre>${escapeHtml(result.compile_output)}</pre>` : ""}
      ${(result.results || []).map((test) => `
        <div class="test-card">
          <strong>${test.index}. ${escapeHtml(test.status)} · ${test.runtime_ms} ms${test.description ? ` · ${escapeHtml(test.description)}` : ""}</strong>
          ${test.input !== undefined ? `<pre>输入\n${escapeHtml(test.input)}\n预期\n${escapeHtml(test.expected)}\n实际\n${escapeHtml(test.actual || "")}${test.stderr ? `\n错误\n${escapeHtml(test.stderr)}` : ""}</pre>` : `<p style="color:#90a49a">隐藏测试仅显示状态与耗时。</p>`}
        </div>
      `).join("")}
      <p style="color:#90a49a;font-size:11px">${escapeHtml(environmentWarning)}</p>
    </div>
  `;
}

let environmentWarning = "本地模式不是强隔离沙箱；多人或生产环境请配置 Judge0。";

async function renderAcm(questionId = null, taskContext = {}) {
  setNav("acm");
  const data = await api("/api/acm/problems");
  if (!data.questions.length) {
    $("#view").innerHTML = pageHead("编程练习", "题库中没有编程题。");
    return;
  }
  const selected = data.questions.find((q) => q.id === questionId) || data.questions[0];
  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  const taskId = query.get("task");
  const taskKind = query.get("kind");
  const [question, draftData, submissionData] = await Promise.all([
    api(`/api/questions/${encodeURIComponent(selected.id)}${state.acmReveal?.[selected.id] ? "?reveal=1" : ""}`),
    api(`/api/drafts?question_id=${encodeURIComponent(selected.id)}`),
    api(`/api/submissions?question_id=${encodeURIComponent(selected.id)}`),
  ]);
  const language = state.acmLanguage[selected.id] || "python";
  const savedCode = state.acmCode[selected.id]?.[language] ?? draftData.drafts?.[language]?.code ?? defaultCode(language);
  const acm = question.acm || {};
  const result = state.acmResult[selected.id] || null;
  const sampleInput = String(acm.sample_input ?? "").trimEnd() || "—";
  const sampleOutput = String(acm.sample_output ?? "").trimEnd() || "—";
  const solutionHtml = state.acmReveal?.[selected.id] ? `
    <section class="panel" style="margin-top:18px">
      <header class="panel-head"><h2>解题参考</h2><small class="spacer">查看后此次提交不计入独立掌握度</small></header>
      <div class="panel-body">
        <div class="markdown-body">${renderMarkdown(question.explanation || "")}</div>
        <h3>Python 3</h3><pre class="code-block">${escapeHtml(question.acm?.reference_python || "")}</pre>
        <h3>C++17</h3><pre class="code-block">${escapeHtml(question.acm?.reference_cpp || "")}</pre>
      </div>
    </section>` : "";
  $("#view").innerHTML = `
    <header class="acm-page-head">
      <div>
        <span class="acm-eyebrow">代码评测</span>
        <h1>Python / C++17 编程练习</h1>
        <p>程序读取标准输入并输出答案。样例运行与正式提交使用同一评测服务，只保存正式提交。</p>
      </div>
      <div class="acm-page-controls">
        ${taskId ? `<a class="btn" href="#/daily/${attr(question.id)}">返回今日任务</a>` : ""}
        <label class="acm-select-wrap">
          <span>选择题目</span>
          <select id="acm-problem-select">${data.questions.map((q) => `<option value="${attr(q.id)}" ${q.id === selected.id ? "selected" : ""}>${escapeHtml(questionDisplayTitle(q.title))}</option>`).join("")}</select>
        </label>
      </div>
    </header>
    <div class="acm-layout">
      <article class="panel problem-statement">
        <div class="panel-body">
          <div class="question-meta">
            <span class="pill orange">编程题</span>
            <span class="pill">${escapeHtml(question.difficulty)}</span>
            <span class="pill">${escapeHtml(selected.module_title || question.module_title || question.module_id)}</span>
            <span class="pill">Python / C++17</span>
          </div>
          <h1 class="question-title">${escapeHtml(questionDisplayTitle(question.title))}</h1>
          <section class="problem-section">
            <h2>题目描述</h2>
            <div class="question-stem">${renderMarkdown(question.stem)}</div>
          </section>
          <section class="problem-section problem-spec-grid">
            <div>
              <h2>输入格式</h2>
              <div class="problem-copy">${renderMarkdown(acm.input_format || "")}</div>
            </div>
            <div>
              <h2>输出格式</h2>
              <div class="problem-copy">${renderMarkdown(acm.output_format || "")}</div>
            </div>
          </section>
          <section class="problem-example">
            <h2>示例 1</h2>
            <div class="example-line"><span>输入</span><code>${escapeHtml(sampleInput)}</code></div>
            <div class="example-line"><span>输出</span><code>${escapeHtml(sampleOutput)}</code></div>
            ${acm.sample_explanation ? `<p class="example-note"><strong>解释：</strong>${escapeHtml(acm.sample_explanation)}</p>` : ""}
          </section>
          <section class="constraint-box">
            <h2>数据范围与提示</h2>
            <p>${escapeHtml(acm.constraints || "未提供额外约束。")}</p>
            ${acm.complexity ? `<p>${escapeHtml(acm.complexity)}</p>` : ""}
            <div class="constraint-facts"><span>时间限制 ${Number(acm.time_limit_ms || 0) || "—"} ms</span><span>内存限制 ${Number(acm.memory_limit_mb || 0) || "—"} MB</span></div>
          </section>
          <div class="form-actions problem-actions"><button class="btn small" type="button" data-action="reveal-acm" data-id="${attr(question.id)}">查看解法（会标记）</button></div>
        </div>
      </article>
      <div>
        <section class="panel editor-panel">
          <div class="editor-toolbar">
            <div class="lang-switch">
              <button type="button" class="${language === "python" ? "active" : ""}" data-action="acm-language" data-id="${attr(question.id)}" data-lang="python">Python 3</button>
              <button type="button" class="${language === "cpp" ? "active" : ""}" data-action="acm-language" data-id="${attr(question.id)}" data-lang="cpp">C++17</button>
            </div>
            <span class="spacer"></span>
            <button class="btn small" type="button" data-action="save-draft" data-id="${attr(question.id)}" data-lang="${language}">保存草稿</button>
            <button class="btn small" type="button" data-action="custom-run" data-id="${attr(question.id)}" data-lang="${language}">自定义输入</button>
            <button class="btn small" type="button" data-action="judge-run" data-id="${attr(question.id)}" data-lang="${language}" data-mode="sample" data-task="${attr(taskId || "")}" data-kind="${attr(taskKind || "")}">运行样例</button>
            <button class="btn small orange" type="button" data-action="judge-run" data-id="${attr(question.id)}" data-lang="${language}" data-mode="submit" data-task="${attr(taskId || "")}" data-kind="${attr(taskKind || "")}">正式提交</button>
          </div>
          <textarea class="code-editor" id="code-editor" spellcheck="false" aria-label="代码编辑器">${escapeHtml(savedCode)}</textarea>
          <div id="judge-output">${judgeHtml(result)}</div>
        </section>
        <section class="panel" style="margin-top:18px">
          <header class="panel-head"><h2>提交历史</h2><small class="spacer">按语言分别保留</small></header>
          <div class="panel-body">
            ${submissionData.submissions.length ? `<div class="timeline">${submissionData.submissions.map((sub) => `
              <div class="timeline-item ${sub.status === "ACCEPTED" ? "done" : ""}">
                <h3>${escapeHtml(sub.status)} · ${escapeHtml(sub.language)}</h3>
                <p>${sub.passed_count}/${sub.total_count} 测试 · ${sub.runtime_ms} ms · ${formatDate(sub.created_at, true)}</p>
              </div>
            `).join("")}</div>` : `<div class="empty-state"><strong>尚无正式提交</strong>先运行样例，再提交全部测试。</div>`}
          </div>
        </section>
        ${solutionHtml}
      </div>
    </div>
  `;
  $("#acm-problem-select")?.addEventListener("change", (event) => {
    location.hash = `#/acm/${event.target.value}${taskId ? `?task=${taskId}&kind=${taskKind}` : ""}`;
  });
}

async function renderMap(moduleId = null) {
  setNav("map");
  const modules = await loadModules();
  if (!moduleId) {
    $("#view").innerHTML = `
      ${pageHead("学习地图", "10 个模块按岗位优先级组成学习网络。节点状态来自真实答题记录，不按浏览行为伪造。")}
      <div class="map-grid">
        ${modules.map((module) => `
          <a class="map-card" href="#/map/${attr(module.id)}" style="--module-color:${attr(module.color)};text-decoration:none">
            <h3>${escapeHtml(module.title)}</h3>
            <p>${escapeHtml(module.description)}</p>
            <small>${escapeHtml(module.stage)} · ${escapeHtml(moduleLevel(module))}</small>
          </a>
        `).join("")}
      </div>
      <div class="panel" style="margin-top:20px"><div class="panel-body"><div class="notice info">正在显示掌握状态：绿色表示已掌握，橙色表示学习中，灰色表示未开始。当前知识关系由课程结构初始化，数据保存在 SQLite。</div></div></div>
    `;
    return;
  }
  const data = await api(`/api/mindmap/${encodeURIComponent(moduleId)}`);
  state.mindmapData = data;
  const nodes = data.nodes;
  const rootX = 30;
  const rootY = 230;
  const positions = nodes.map((node, index) => ({
    ...node,
    x: 310 + (index % 3) * 230,
    y: 65 + Math.floor(index / 3) * 155,
  }));
  const nodeMap = Object.fromEntries(positions.map((node) => [node.id, node]));
  const paths = data.edges.map((edge) => {
    const from = nodeMap[edge.from_kp_id];
    const to = nodeMap[edge.to_kp_id];
    if (!from || !to) return "";
    const x1 = from.x + 190;
    const y1 = from.y + 35;
    const x2 = to.x;
    const y2 = to.y + 35;
    const mid = (x1 + x2) / 2;
    return `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none" stroke="#9baaa2" stroke-width="1.5" marker-end="url(#arrow)"></path>`;
  }).join("");
  const colors = { mastered: "#2c7957", learning: "#f06a3a", not_started: "#96a49c" };
  const states = { mastered: "已掌握", learning: "学习中", not_started: "未开始" };
  const kpNames = Object.fromEntries(nodes.map((node) => [node.id, node.title]));
  const relationRows = data.edges.map((edge) => `
    <div class="weak-item">
      <div><strong>${escapeHtml(kpNames[edge.from_kp_id] || edge.from_kp_id)} → ${escapeHtml(kpNames[edge.to_kp_id] || edge.to_kp_id)}</strong><small>${escapeHtml(edge.label)} · ${edge.is_custom ? "自建关系" : "课程结构"}</small></div>
      ${edge.is_custom ? `<button class="btn small danger" type="button" data-action="delete-relation" data-id="${edge.id}">删除</button>` : `<span class="pill">内置</span>`}
    </div>
  `).join("");
  $("#view").innerHTML = `
    ${pageHead(moduleId && data.module.title, "拖动或缩放画布查看结构，点击节点读取知识点资料。这里不是静态图片。", `<a class="btn" href="#/map">返回全图</a><a class="btn primary" href="#/modules/${attr(moduleId)}">模块详情</a>`)}
    <section class="panel">
      <div class="mindmap-toolbar">
        <button class="btn small" type="button" data-action="map-zoom" data-delta="0.1">放大</button>
        <button class="btn small" type="button" data-action="map-zoom" data-delta="-0.1">缩小</button>
        <button class="btn small" type="button" data-action="map-reset">重置</button>
        <button class="btn small" type="button" data-action="add-relation" data-module="${attr(moduleId)}">新增关系</button>
        <span style="margin-left:auto;color:var(--ink-soft);font-size:11px">缩放 ${Math.round(state.mindmapZoom * 100)}% · ${nodes.length} 个知识点</span>
      </div>
      <div class="mindmap-stage" id="mindmap-stage">
        <div class="mindmap-canvas" id="mindmap-canvas" style="transform:scale(${state.mindmapZoom})">
          <svg viewBox="0 0 980 560" preserveAspectRatio="none">
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#9baaa2"></path></marker></defs>
            <path d="M250,273 C280,273 280,100 310,100" fill="none" stroke="${attr(data.module.color)}" stroke-width="2"></path>
            <path d="M250,273 C280,273 280,255 310,255" fill="none" stroke="${attr(data.module.color)}" stroke-width="2"></path>
            ${paths}
          </svg>
          <div class="mindmap-node root" style="left:${rootX}px;top:${rootY - 44}px">
            <strong>${escapeHtml(data.module.short_title)}</strong>
            <small>${escapeHtml(data.module.target_level)}目标 · 点击知识点继续</small>
          </div>
          ${positions.map((node) => `
            <button class="mindmap-node" type="button" data-action="open-kp" data-id="${attr(node.id)}" style="left:${node.x}px;top:${node.y}px;--node-color:${colors[node.state]};text-align:left">
              <strong>${escapeHtml(node.title)}</strong>
              <small>${states[node.state]} · 查看资料</small>
            </button>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:18px">
      <header class="panel-head"><h2>知识点关系</h2><small class="spacer">${data.edges.length} 条 · 自建关系可删除</small></header>
      <div class="panel-body"><div class="weak-list">${relationRows}</div></div>
    </section>
  `;
}

async function renderModules(moduleId = null) {
  setNav(moduleId ? "map" : "modules");
  if (!moduleId) {
    const modules = await loadModules();
    $("#view").innerHTML = `
      ${pageHead("10 个知识模块", "四级掌握度长期保留，但四个月阶段目标按转岗岗位价值设置，不要求所有模块达到精通。")}
      <div class="map-grid">${modules.map((m) => `
        <a class="map-card" href="#/modules/${attr(m.id)}" style="--module-color:${attr(m.color)};text-decoration:none">
          <h3>${String(m.position).padStart(2, "0")} ${escapeHtml(m.title)}</h3>
          <p>${escapeHtml(m.description)}</p>
          <small>${escapeHtml(moduleLevel(m))} · 目标 ${escapeHtml(m.target_level)}</small>
        </a>
      `).join("")}</div>
    `;
    return;
  }
  const data = await api(`/api/modules/${encodeURIComponent(moduleId)}`);
  const m = data.module;
  const mastery = data.mastery;
  const next = mastery.next_requirements;
  const displayLevel = mastery.display_level || "未入门";
  const qcounts = Object.entries(data.question_counts).map(([type, count]) => `<span class="pill">${escapeHtml(type)} ${count}</span>`).join("");
  $("#view").innerHTML = `
    <div class="page-head"><div></div><div class="page-actions"><a class="btn" href="#/modules">全部模块</a><a class="btn" href="#/map/${attr(m.id)}">打开导图</a><a class="btn primary" href="#/practice">去练题</a></div></div>
    <section class="module-banner" style="border-top:4px solid ${attr(m.color)}">
      <div>
        <div class="question-meta"><span class="pill">模块 ${m.position}</span><span class="pill">优先级 ${m.priority}</span><span class="pill">${escapeHtml(m.stage)}</span></div>
        <h1>${escapeHtml(m.title)}</h1>
        <p>${escapeHtml(m.description)}</p>
        <div class="form-actions">${qcounts}</div>
      </div>
      <div class="mastery-summary"><small>当前晋级等级</small><strong>${escapeHtml(displayLevel)}</strong><small>阶段目标：${escapeHtml(m.target_level)}</small></div>
    </section>
    <div class="dashboard-grid" style="margin-top:20px">
      <div class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>晋级差距</h2><small class="spacer">${next ? `下一等级：${escapeHtml(next.level)}` : "已达到最高等级或等待评估"}</small></header>
          <div class="panel-body">
            <div class="metric-grid">
              <div class="metric-box"><strong>${percent(mastery.accuracy)}</strong><small>独立正确率</small></div>
              <div class="metric-box"><strong>${mastery.distinct_questions}</strong><small>不同逻辑题</small></div>
              <div class="metric-box"><strong>${percent(mastery.coverage)}</strong><small>知识点覆盖</small></div>
            </div>
            ${next ? `<div class="requirement-list" style="margin-top:18px">
              <div class="requirement-row"><span>正确率</span><span>当前 ${percent(next.current_accuracy)} / 需要 ${percent(next.accuracy)}</span></div>
              <div class="requirement-row"><span>不同题目</span><span>当前 ${next.current_distinct} / 需要 ${next.distinct}（还差 ${next.needed_accuracy_hits}）</span></div>
              <div class="requirement-row"><span>覆盖知识点</span><span>当前 ${mastery.covered_knowledge_points}/${mastery.total_knowledge_points} / 需要 ${percent(next.coverage)}</span></div>
              ${m.id === "python" || m.id === "cpp" ? `<div class="requirement-row"><span>语言实践</span><span>${mastery.language_ok ? "已有一道该语言 Accepted" : "尚未有该语言 Accepted 记录"}</span></div>` : ""}
            </div>` : ""}
            ${mastery.unmet_conditions?.length ? `<div class="notice" style="margin-top:16px">未达标：${mastery.unmet_conditions.filter((x) => !x.passed).map((x) => escapeHtml(x.condition)).join("、")}</div>` : ""}
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>知识点</h2><small class="spacer">点击读取教学资料</small></header>
          <div class="panel-body"><div class="question-nav">
            ${data.knowledge_points.map((kp) => `
              <button class="task-nav-item" type="button" data-action="open-kp" data-id="${attr(kp.id)}">
                <span class="task-check" style="border-color:${kp.state === "mastered" ? "var(--ok)" : "var(--line-strong)"};color:${kp.state === "mastered" ? "var(--ok)" : "var(--ink-soft)"}">${kp.passed_count}</span>
                <span><strong style="display:block;color:var(--ink);font-size:12px">${escapeHtml(kp.title)}</strong><small>${escapeHtml(kp.summary)}</small></span>
              </button>
            `).join("")}
          </div></div>
        </section>
      </div>
      <aside class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>等级变化记录</h2></header>
          <div class="panel-body">
            ${data.level_history.length ? `<div class="timeline">${data.level_history.map((h) => `<div class="timeline-item done"><h3>${escapeHtml(h.level)}</h3><p>${formatDate(h.created_at, true)} · 指标已保存</p></div>`).join("")}</div>` : `<div class="empty-state"><strong>尚无晋级记录</strong>答题后会依据真实阈值自动记录。</div>`}
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>评估规则</h2></header>
          <div class="panel-body"><p style="margin-top:0;font-size:12px;color:var(--ink-soft)">同一逻辑题只计一次；查看解析后完成不算独立掌握；Python 与 C++ 同题不会让题目数量翻倍。等级只升级不在一次失误后直接下降，但实时指标会继续变化。</p></div>
        </section>
      </aside>
    </div>
  `;
}

async function renderReviews() {
  setNav("reviews");
  const data = await api("/api/reviews");
  const today = localDateIso();
  $("#view").innerHTML = `
    ${pageHead("错题与间隔复习", "错题来自真实错误尝试。默认在第 1、3、7、14、30 天安排复习；变式默认由本地模板引擎生成，无需联网。", `<a class="btn primary" href="#/daily">回到今日任务</a>`)}
    <section class="stats-line">
      <div class="stat-cell"><strong>${data.wrong_count}</strong><span>错题总数</span></div>
      <div class="stat-cell"><strong>${data.active_count}</strong><span>复习中</span></div>
      <div class="stat-cell"><strong>${data.due_count}</strong><span>当前到期</span></div>
      <div class="stat-cell"><strong>${data.weak_points[0]?.title || "—"}</strong><span>最薄弱知识点</span></div>
    </section>
    <div class="notice info" style="margin-bottom:16px">复习题独立通过率：${percent(data.review_effect.accuracy)}（${data.review_effect.attempts} 次） · 变式题通过率：${percent(data.variant_effect.accuracy)}（${data.variant_effect.attempts} 次）</div>
    <div class="review-grid">
      ${data.items.length ? data.items.map((item) => `
        <article class="review-card" style="border-left:3px solid ${item.status === "active" && item.due_date <= today ? "var(--orange)" : "var(--line-strong)"}">
          <div class="question-meta"><span class="pill">${escapeHtml(item.module_title)}</span><span class="pill">${escapeHtml(item.kp_title)}</span><span class="pill">${item.status === "completed" ? "已完成" : item.due_date <= today ? "已到期" : "等待复习"}</span></div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>错误 ${item.wrong_count} 次 · 连续通过 ${item.correct_streak} 次 · 下次 ${escapeHtml(item.due_date)}</p>
          <p style="margin-top:6px">错因：${escapeHtml(item.error_category)}</p>
          ${item.variant_title ? `<p style="margin-top:6px">变式：${escapeHtml(item.variant_title)}</p>` : ""}
          <div class="form-actions">
            <a class="btn small primary" href="#/practice/${attr(item.question_id)}">复习原题</a>
            <button class="btn small" type="button" data-action="create-variant" data-id="${item.id}">生成变式</button>
            ${item.variant_question_id ? `<a class="btn small" href="#/practice/${attr(item.variant_question_id)}">练变式</a>` : ""}
          </div>
        </article>
      `).join("") : `<div class="empty-state" style="grid-column:1/-1"><strong>错题本还是空的</strong>答错后会自动保存你的答案、错因、时间和复习计划。</div>`}
    </div>
  `;
}

async function renderNotes() {
  setNav("notes");
  const data = await api(`/api/notes${state.noteSearch ? `?q=${encodeURIComponent(state.noteSearch)}` : ""}`);
  const notes = data.notes;
  const selected = notes.find((n) => n.id === state.noteSelected) || notes[0] || null;
  if (selected) state.noteSelected = selected.id;
  $("#view").innerHTML = `
    ${pageHead("知识笔记", "笔记使用 Markdown 保存；本地版写入 SQLite，云端版同步到你的私人存储。笔记可关联模块、知识点与题目，也可导出单篇 Markdown。", `<button class="btn primary" type="button" data-action="new-note">新建笔记</button>`)}
    <div class="notes-layout">
      <aside class="panel">
        <header class="panel-head"><h2>笔记库</h2><small class="spacer">${notes.length} 篇</small></header>
        <form class="panel-body" data-form="notes-search" style="padding-bottom:0">
          <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto">
            <input type="text" name="q" value="${attr(state.noteSearch)}" placeholder="搜索标题与正文">
            <button class="btn small" type="submit">搜索</button>
          </div>
        </form>
        <div class="note-list">
          ${notes.length ? notes.map((n) => `<button class="note-list-item ${selected?.id === n.id ? "active" : ""}" type="button" data-action="select-note" data-id="${attr(n.id)}"><strong>${escapeHtml(n.title)}</strong><small>${n.favorite ? "收藏 · " : ""}${formatDate(n.updated_at, true)}</small></button>`).join("") : `<div class="empty-state"><strong>还没有笔记</strong>从题目解析或新建开始。</div>`}
        </div>
      </aside>
      <section class="panel">
        <header class="panel-head"><h2>${selected ? escapeHtml(selected.title) : "新建笔记"}</h2><small class="spacer">Markdown</small></header>
        <div class="panel-body">
          <form data-form="note-save" data-id="${attr(selected?.id || "")}">
            <div class="form-row">
              <label class="form-field"><span class="field-label">标题</span><input type="text" name="title" value="${attr(selected?.title || "")}" required></label>
              <label class="form-field"><span class="field-label">收藏</span><select name="favorite"><option value="0">普通笔记</option><option value="1" ${selected?.favorite ? "selected" : ""}>收藏</option></select></label>
            </div>
            <label class="form-field"><span class="field-label">正文</span><textarea id="note-body" name="body" rows="16">${escapeHtml(selected?.body || "# 记录一个关键理解\n\n- 原理\n- 易错点\n- 在测试中的应用")}</textarea></label>
            <div class="form-actions">
              <button class="btn primary" type="submit">保存笔记</button>
              <button class="btn" type="button" data-action="preview-note">刷新预览</button>
              ${selected ? `<button class="btn" type="button" data-action="export-note" data-id="${attr(selected.id)}">导出 Markdown</button><button class="btn danger" type="button" data-action="delete-note" data-id="${attr(selected.id)}">删除</button>` : ""}
            </div>
          </form>
          <h3 style="margin-top:24px">预览</h3>
          <div class="markdown-body" id="note-preview">${renderMarkdown(selected?.body || "")}</div>
        </div>
      </section>
    </div>
  `;
}

function lineChart(series) {
  if (!series.length) return "";
  const width = 760;
  const height = 250;
  const pad = { left: 36, right: 18, top: 18, bottom: 30 };
  const max = Math.max(1, ...series.map((d) => d.attempts));
  const x = (i) => pad.left + i * ((width - pad.left - pad.right) / Math.max(1, series.length - 1));
  const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const points = series.map((d, i) => `${x(i)},${y(d.attempts)}`).join(" ");
  const area = `${pad.left},${height - pad.bottom} ${points} ${width - pad.right},${height - pad.bottom}`;
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近 14 天答题量折线图">
      ${[0, 0.25, 0.5, 0.75, 1].map((ratio) => `<line class="chart-gridline" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + ratio * (height - pad.top - pad.bottom)}" y2="${pad.top + ratio * (height - pad.top - pad.bottom)}"></line><text class="chart-label" x="4" y="${pad.top + ratio * (height - pad.top - pad.bottom) + 3}">${Math.round(max * (1 - ratio))}</text>`).join("")}
      <line class="chart-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"></line>
      <polygon class="chart-area" points="${area}"></polygon>
      <polyline class="chart-line" points="${points}"></polyline>
      ${series.map((d, i) => `<circle class="chart-dot" cx="${x(i)}" cy="${y(d.attempts)}" r="3.5"><title>${d.date}：${d.attempts} 次</title></circle>${i % 2 === 0 ? `<text class="chart-label" x="${x(i)}" y="${height - 9}" text-anchor="middle">${d.date.slice(5)}</text>` : ""}`).join("")}
    </svg>
  `;
}

async function renderAnalytics() {
  setNav("analytics");
  const [stats, readiness, modules] = await Promise.all([
    api("/api/stats"),
    api("/api/readiness"),
    loadModules(),
  ]);
  const lang = stats.language;
  $("#view").innerHTML = `
    ${pageHead("学习统计与转岗就绪度", "所有图表来自答题、代码提交、复习与项目记录。准备度是能力检查分数，不是录用概率。")}
    <section class="panel chart-panel">
      <header class="panel-head"><h2>近 14 天答题量</h2><small class="spacer">真实 attempts 记录</small></header>
      <div class="panel-body">${lineChart(stats.last_14_days)}</div>
    </section>
    <section class="analytics-snapshot" aria-label="学习数据概览">
      <article class="snapshot-card" style="--snapshot-accent:var(--cyan)">
        <span>作答记录</span>
        <strong>${stats.total_attempts}</strong>
        <b>累计答题</b>
        <small>来自已保存的答题尝试</small>
      </article>
      <article class="snapshot-card" style="--snapshot-accent:var(--orange)">
        <span>自动判分</span>
        <strong>${percent(stats.accuracy)}</strong>
        <b>正确率</b>
        <small>只统计可自动判分的作答</small>
      </article>
      <article class="snapshot-card" style="--snapshot-accent:var(--blue)">
        <span>学习节奏</span>
        <strong>${stats.streak}</strong>
        <b>连续学习天数</b>
        <small>按真实答题日期计算</small>
      </article>
      <article class="snapshot-card" style="--snapshot-accent:var(--ok)">
        <span>编程掌握</span>
        <strong>${stats.accepted_logical_problems}</strong>
        <b>Accepted 逻辑题</b>
        <small>同一道题跨语言只计一次</small>
      </article>
    </section>
    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>模块覆盖率与正确率</h2></header>
          <div class="panel-body"><div class="module-bars">
            ${modules.map((m) => `<div class="module-bar-row"><span>${escapeHtml(m.short_title)}</span><div class="module-bar-track" style="--module-color:${attr(m.color)}"><span style="width:${Math.round(m.coverage * 100)}%"></span></div><span>${percent(m.coverage)}</span></div>`).join("")}
          </div></div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>Python / C++ 独立完成</h2><small class="spacer">同一逻辑题只计一次掌握</small></header>
          <div class="panel-body">
            <div class="metric-grid">
              <div class="metric-box"><strong>${lang.python.accepted_questions}</strong><small>Python 独立 Accepted</small></div>
              <div class="metric-box"><strong>${lang.cpp.accepted_questions}</strong><small>C++ 独立 Accepted</small></div>
              <div class="metric-box"><strong>${stats.total_submissions}</strong><small>正式代码提交</small></div>
            </div>
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>复习效果</h2></header>
          <div class="panel-body">
            <div class="metric-grid">
              <div class="metric-box"><strong>${percent(stats.review_effect.accuracy)}</strong><small>复习题正确率</small></div>
              <div class="metric-box"><strong>${percent(stats.review_effect.before_accuracy)}</strong><small>非复习答题正确率</small></div>
              <div class="metric-box"><strong>${stats.review_effect.attempts}</strong><small>复习尝试</small></div>
            </div>
          </div>
        </section>
      </div>
      <aside class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>${readiness.score}/100 · ${escapeHtml(readiness.label)}</h2></header>
          <div class="panel-body">
            <div class="requirement-list">
              ${readiness.criteria.map((item) => `<div class="requirement-row"><span>${item.passed ? "已形成证据" : "未达标"}</span><span><strong>${escapeHtml(item.title)}</strong><br><small style="color:var(--ink-soft)">${escapeHtml(item.evidence)}</small></span></div>`).join("")}
            </div>
            <div class="notice" style="margin-top:16px">${escapeHtml(readiness.disclaimer)}</div>
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>等级变化</h2></header>
          <div class="panel-body">
            ${stats.level_changes.length ? `<div class="timeline">${stats.level_changes.slice(0, 8).map((item) => `<div class="timeline-item done"><h3>${escapeHtml(item.short_title)} · ${escapeHtml(item.level)}</h3><p>${formatDate(item.created_at, true)}</p></div>`).join("")}</div>` : `<div class="empty-state"><strong>尚无等级记录</strong></div>`}
          </div>
        </section>
      </aside>
    </div>
  `;
}

async function renderProject() {
  setNav("project");
  const data = await api("/api/projects");
  const milestones = data.milestones || [];
  const done = milestones.filter((m) => m.status === "done").length;
  $("#view").innerHTML = `
    ${pageHead(data.project?.title || "测试开发实战项目", data.project?.description || "项目尚未初始化。", `<a class="btn" href="#/notes">整理项目笔记</a><a class="btn primary" href="#/interview">练习项目追问</a>`)}
    ${data.project?.repository_path ? `<div class="notice info">实战代码目录：<strong>${escapeHtml(data.project.repository_path)}</strong> · 可用 <code>python -m unittest discover -s practice_project/tests -v</code> 验证。这里只记录真实证据，不自动宣称项目完成。</div>` : ""}
    <section class="stats-line">
      <div class="stat-cell"><strong>${done}/${milestones.length}</strong><span>里程碑完成</span></div>
      <div class="stat-cell"><strong>${milestones.filter((m) => m.evidence).length}</strong><span>有真实证据</span></div>
      <div class="stat-cell"><strong>${milestones.filter((m) => m.status === "doing").length}</strong><span>进行中</span></div>
      <div class="stat-cell"><strong>2.25</strong><span>建议演示日期<br>2027 年</span></div>
    </section>
    <section class="panel">
      <header class="panel-head"><h2>阶段里程碑</h2><small class="spacer">状态与证据都会计入就绪度</small></header>
      <div class="panel-body"><div class="timeline">
        ${milestones.map((m) => `
          <article class="timeline-item ${m.status}">
            <h3>${escapeHtml(m.title)}</h3>
            <p>${escapeHtml(m.description)}</p>
            <p><span class="pill">${m.status === "done" ? "已完成" : m.status === "doing" ? "进行中" : "待开始"}</span> 截止 ${formatDate(m.due_date)}</p>
            ${m.evidence ? `<div class="notice info">证据：${escapeHtml(m.evidence)}</div>` : ""}
            <form class="milestone-editor" data-form="milestone" data-id="${attr(m.id)}">
              <select name="status"><option value="todo" ${m.status === "todo" ? "selected" : ""}>待开始</option><option value="doing" ${m.status === "doing" ? "selected" : ""}>进行中</option><option value="done" ${m.status === "done" ? "selected" : ""}>已完成</option></select>
              <input type="text" name="evidence" value="${attr(m.evidence)}" placeholder="填写真实证据：报告、提交、命令结果或文档位置">
              <button class="btn small" type="submit">保存</button>
            </form>
          </article>
        `).join("")}
      </div></div>
    </section>
  `;
}

async function renderInterview() {
  setNav("interview");
  const data = await api("/api/interviews");
  const active = state.activeInterview;
  let interviewHtml = "";
  if (active) {
    interviewHtml = `
      <section class="panel">
        <header class="panel-head"><h2>${escapeHtml(active.title)}</h2><small class="spacer">自评型模拟面试</small></header>
        <div class="panel-body">
          <form data-form="interview-save" data-id="${attr(active.id)}">
            ${active.questions.map((q, index) => `
              <article class="interview-question">
                <div class="question-meta"><span class="pill">第 ${index + 1} 题</span><span class="pill">${escapeHtml(questionTypeLabel(q.type))}</span><span class="pill">${escapeHtml(q.difficulty)}</span></div>
                <h3>${escapeHtml(q.title)}</h3>
                <div>${renderMarkdown(q.stem)}</div>
                ${q.type === "acm" ? `<div class="notice info">本题需要实际编程。请先到 ACM 工作台完成并保存提交，再按评分标准自评。 <a class="text-link" href="#/acm/${attr(q.id)}">打开 ACM 工作台</a></div>` : ""}
                ${q.rubric?.length ? `<ul class="rubric">${q.rubric.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
                <label class="form-field"><span class="field-label">作答记录</span><textarea name="answer_${index}" rows="4">${escapeHtml(active.answers?.[index]?.answer || "")}</textarea></label>
                <label class="form-field"><span class="field-label">自评分数（0–100）</span><input type="number" name="score_${index}" min="0" max="100" value="${active.answers?.[index]?.self_score ?? ""}" required></label>
              </article>
            `).join("")}
            <div class="form-actions"><button class="btn" type="submit" name="finish" value="0">保存进度</button><button class="btn primary" type="submit" name="finish" value="1">完成并生成报告</button></div>
          </form>
        </div>
      </section>
    `;
  }
  $("#view").innerHTML = `
    ${pageHead("模拟面试", "技术问答、测试方案与项目追问使用明确评分标准自评。平台不会把自评分伪装成自动面试结论。", `<button class="btn primary" type="button" data-action="start-interview">开始一轮模拟</button>`)}
    ${interviewHtml}
    <section class="panel" style="margin-top:18px">
      <header class="panel-head"><h2>历史面试报告</h2><small class="spacer">${data.interviews.length} 次</small></header>
      <div class="panel-body">
        ${data.interviews.length ? `<div class="review-grid">${data.interviews.map((item) => `
          <article class="review-card">
            <div class="question-meta"><span class="pill">${item.status === "completed" ? "已完成" : "进行中"}</span><span class="pill">${item.questions.length} 题</span></div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>自评平均分：${item.score ?? "—"} · ${formatDate(item.created_at, true)}</p>
            ${item.status === "completed" ? `<p>优势：${escapeHtml(item.strengths)}</p><p>短板：${escapeHtml(item.weaknesses)}</p>` : ""}
            <div class="form-actions"><button class="btn small" type="button" data-action="open-interview" data-id="${attr(item.id)}">继续或复盘</button></div>
          </article>
        `).join("")}</div>` : `<div class="empty-state"><strong>还没有模拟记录</strong>先从 6 道题开始，控制在 30–45 分钟。</div>`}
      </div>
    </section>
  `;
}

async function renderPlan() {
  setNav("plan");
  const data = await api("/api/plan");
  $("#view").innerHTML = `
    ${pageHead("四个月学习计划", "阶段安排是动态优先级，不是完成所有内容的硬承诺。核心缺口会挤占拓展内容时间。")}
    <section class="panel"><div class="panel-body"><div class="timeline">
      ${data.phases.map((phase) => `
        <article class="timeline-item ${phase.id === data.current?.id ? "doing" : phase.end_date < data.current?.start_date ? "done" : ""}">
          <h3>${escapeHtml(phase.title)}</h3>
          <p class="phase-meta"><span class="phase-date">${escapeHtml(phase.start_date)} — ${escapeHtml(phase.end_date)}</span><strong class="phase-theme">${escapeHtml(phase.theme)}</strong></p>
          <ul class="rubric">${(phase.outcomes || []).map((outcome) => `<li>${escapeHtml(outcome)}</li>`).join("")}</ul>
        </article>
      `).join("")}
    </div></div></section>
    <section class="panel" style="margin-top:18px"><header class="panel-head"><h2>未完成任务的调整规则</h2></header><div class="panel-body"><p style="margin:0;color:var(--ink-soft)">每日重排会优先保留岗位核心知识、项目里程碑与到期复习；不会把所有历史未完成题机械堆积到第二天。修改每日题量只改变未完成部分，已答记录与已完成任务始终保留。</p></div></section>
  `;
}

async function renderSettings() {
  setNav("settings");
  const settings = await api("/api/settings");
  const cloudStorage = Boolean(settings.environment?.online);
  const browserStorage = settings.environment?.storage_mode === "browser";
  const remoteUnavailable = cloudStorage || browserStorage;
  const h = Object.keys(settings.mastery_thresholds);
  const aiWarning = cloudStorage
    ? `<div class="notice">当前是 Netlify 云端学习版，学习记录会同步到私人 Blob 空间。远程模型不会把密钥暴露给浏览器，因此在线版只开放本地动态题库。</div>`
    : browserStorage
    ? `<div class="notice info">当前是静态在线版，学习记录保存在当前浏览器。远程模型密钥不会进入公开静态页面，因此只开放本地动态题库。</div>`
    : settings.ai_api_key_configured
    ? `<div class="notice info">远程模型密钥已配置，密钥不会返回浏览器。</div>`
    : `<div class="notice">远程模型属于可选增强，当前未配置；本地动态题库、资料索引和代码评测可直接使用。</div>`;
  const judge = settings.environment.judge;
  $("#view").innerHTML = `
    ${pageHead("设置与数据", `配置每天的目标、晋级阈值、复习间隔与外部服务。${browserStorage ? "学习数据保存在当前浏览器。" : cloudStorage ? "学习数据同步到私人云端空间。" : "学习数据存在 SQLite，不使用内存伪记录。"}`)}
    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <form class="panel" data-form="settings-basic">
          <header class="panel-head"><h2>学习节奏</h2></header>
          <div class="panel-body">
            <div class="form-row single">
              <label class="form-field"><span class="field-label">每日题量</span><input type="number" name="daily_question_target" min="1" max="50" value="${settings.daily_question_target}"></label>
            </div>
            <label class="form-field"><span class="field-label">复习间隔（逗号分隔）</span><input type="text" name="review_intervals" value="${attr(settings.review_intervals.join(", "))}"></label>
            <button class="btn primary" type="submit">保存并重排今日未完成任务</button>
          </div>
        </form>
        <form class="panel" data-form="settings-thresholds">
          <header class="panel-head"><h2>四级晋级阈值</h2><small class="spacer">正确率与覆盖率用 0–1</small></header>
          <div class="panel-body">
            <div class="threshold-grid">
              <span class="header">等级</span><span class="header">正确率</span><span class="header">不同题数</span><span class="header">知识点覆盖</span>
              ${h.map((level) => `
                <span>${escapeHtml(level)}</span>
                <input type="number" min="0" max="1" step="0.01" name="acc_${attr(level)}" value="${settings.mastery_thresholds[level].accuracy}">
                <input type="number" min="1" name="dist_${attr(level)}" value="${settings.mastery_thresholds[level].distinct}">
                <input type="number" min="0" max="1" step="0.01" name="cov_${attr(level)}" value="${settings.mastery_thresholds[level].coverage}">
              `).join("")}
            </div>
            <div class="form-actions"><button class="btn" type="submit">保存阈值</button></div>
          </div>
        </form>
        <form class="panel" data-form="settings-ai">
          <header class="panel-head"><h2>动态题库与可选联网增强</h2></header>
          <div class="panel-body">
            <div class="notice info"><strong>本地动态题库已启用。</strong> 无需 Key、无需联网；33 个知识点均可生成题目，进阶编程题会先通过 Python/C++17 双语言评测。</div>
            <label class="form-field"><span class="field-label">默认生成引擎</span>
              <select name="question_generation_engine">
                <option value="local" ${settings.question_generation_engine === "local" ? "selected" : ""}>本地模板（推荐，无需配置）</option>
                <option value="remote" ${settings.question_generation_engine === "remote" ? "selected" : ""} ${remoteUnavailable ? "disabled" : ""}>远程 OpenAI 兼容模型（${remoteUnavailable ? "在线版不可用" : "可选"}）</option>
              </select>
            </label>
            ${aiWarning}
            <details style="margin:14px 0" ${remoteUnavailable ? "hidden" : ""}>
              <summary style="cursor:pointer;font-weight:650">高级：远程模型与实时检索</summary>
              <p style="font-size:12px;color:var(--ink-soft)">只有切到远程引擎才会使用这些配置。实时检索 Key 仍可选。</p>
              <div class="form-row">
                <label class="form-field"><span class="field-label">OpenAI 兼容 Base URL</span><input type="text" name="ai_base_url" value="${attr(settings.ai_base_url)}" placeholder="https://api.openai.com/v1"></label>
                <label class="form-field"><span class="field-label">模型名称</span><input type="text" name="ai_model" value="${attr(settings.ai_model)}" placeholder="配置服务端实际模型名"></label>
              </div>
              <div class="form-row three">
                <label class="form-field"><span class="field-label">API Key（留空不修改）</span><input type="password" name="ai_api_key" autocomplete="off" placeholder="${settings.ai_api_key_configured ? "已配置，留空保持不变" : "尚未配置"}"></label>
                <label class="form-field"><span class="field-label">Tavily API Key（可选）</span><input type="password" name="tavily_api_key" autocomplete="off" placeholder="${settings.tavily_api_key_configured ? "已配置，留空保持不变" : "未配置"}"></label>
                <label class="form-field"><span class="field-label">超时（秒）</span><input type="number" name="ai_timeout_seconds" min="5" max="180" value="${settings.ai_timeout_seconds}"></label>
              </div>
            </details>
            <div class="form-actions"><button class="btn primary" type="submit">保存生成设置</button><button class="btn" type="button" data-action="open-ai-generator">立即动态出题</button></div>
          </div>
        </form>
      </div>
      <aside class="dashboard-stack">
        <section class="panel">
          <header class="panel-head"><h2>代码评测环境</h2></header>
          <div class="panel-body">
            <p><span class="pill ${judge.available ? "orange" : ""}">${escapeHtml(judge.label)}</span></p>
            <p style="font-size:12px;color:var(--ink-soft)">${escapeHtml(judge.warning || "评测服务已准备好。")}</p>
            <div class="notice">${escapeHtml(judge.mode)} 模式由服务端环境变量控制。生产与多人使用请使用 Judge0。</div>
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>备份与恢复</h2></header>
          <div class="panel-body">
            <p style="font-size:12px;color:var(--ink-soft)">导出不会包含 AI 或检索密钥。${cloudStorage ? "云端版会自动同步，仍建议定期导出备份。" : browserStorage ? "记录保存在当前浏览器，建议定期导出备份。" : "覆盖导入必须勾选确认，失败会整体回滚。"}</p>
            <div class="form-actions"><button class="btn primary" type="button" data-action="export-data">导出学习数据</button><button class="btn" type="button" data-action="open-import-data">导入备份</button>${cloudStorage ? `<button class="btn danger" type="button" data-action="clear-online-data">清空云端数据</button>` : ""}</div>
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>题库扩展</h2></header>
          <div class="panel-body"><p style="font-size:12px;color:var(--ink-soft)">本地题会经过结构、答案和去重校验；ACM 题还要通过双语言隐藏测试。远程来源会显示待确认状态。</p><div class="form-actions"><button class="btn" type="button" data-action="open-ai-generator">动态出题</button><button class="btn" type="button" data-action="open-question-import">用户导入</button></div></div>
        </section>
      </aside>
    </div>
  `;
}

async function route() {
  const raw = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [pathPart, queryPart] = raw.split("?");
  state.route = pathPart.split("/").filter(Boolean);
  const root = state.route[0] || "dashboard";
  closeMenu();
  if (root === "notes" || root === "project") {
    location.hash = "#/dashboard";
    return;
  }
  const kickers = {
    dashboard: "学习控制台",
    daily: "今日学习",
    practice: "专项题库",
    acm: "代码评测",
    map: "知识结构",
    modules: "模块评估",
    reviews: "错题复习",
    notes: "知识管理",
    analytics: "数据分析",
    project: "项目实战",
    interview: "面试训练",
    plan: "四个月计划",
    settings: "设置与数据",
  };
  $("#page-kicker").textContent = kickers[root] || "学习控制台";
  setLoading();
  try {
    if (root === "dashboard") await renderDashboard();
    else if (root === "daily") await renderDaily(state.route[1]);
    else if (root === "practice") await renderPractice(state.route[1]);
    else if (root === "acm") {
      if (!state.route[1]) {
        location.hash = "#/daily";
        return;
      }
      await renderAcm(state.route[1]);
    }
    else if (root === "map") await renderMap(state.route[1]);
    else if (root === "modules") await renderModules(state.route[1]);
    else if (root === "reviews") await renderReviews();
    else if (root === "notes") await renderNotes();
    else if (root === "analytics") await renderAnalytics();
    else if (root === "project") await renderProject();
    else if (root === "interview") await renderInterview();
    else if (root === "plan") await renderPlan();
    else if (root === "settings") await renderSettings();
    else {
      location.hash = "#/dashboard";
    }
  } catch (error) {
    $("#view").innerHTML = `<div class="empty-state"><strong>页面加载失败</strong><p>${escapeHtml(error.message)}</p><button class="btn" data-action="reload-page">重试</button></div>`;
    showToast(error.message, "error");
  }
}

async function openKnowledgePoint(id) {
  try {
    const kp = await api(`/api/knowledge/${encodeURIComponent(id)}`);
    const c = kp.content || {};
    openModal(kp.title, `
      <p><span class="pill">${escapeHtml(kp.module_title)}</span></p>
      <p>${escapeHtml(kp.summary)}</p>
      <h3>为什么学习</h3><p>${escapeHtml(c.why || "")}</p>
      <h3>核心原理</h3><div class="markdown-body">${renderMarkdown(c.principle || "")}</div>
      ${c.example ? `<h3>示例</h3><pre class="code-block">${escapeHtml(c.example)}</pre>` : ""}
      <h3>常见错误</h3><p>${escapeHtml(c.errors || "")}</p>
      <h3>测试开发中的应用</h3><p>${escapeHtml(c.test_use || "")}</p>
      <h3>面试问题</h3><p>${escapeHtml(c.interview || "")}</p>
      ${(kp.sources || []).length ? `<h3>内置官方资料</h3><ul>${kp.sources.map((source) => `<li><a class="text-link" href="${attr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><br><small>${escapeHtml(source.kind)} · ${escapeHtml(source.verification)}</small></li>`).join("")}</ul>` : ""}
      <h3>关联练习</h3><div class="question-nav">${kp.questions.map((q) => `<a class="btn small" href="#/practice/${attr(q.id)}">${escapeHtml(q.title)}</a>`).join("")}</div>
      <div class="form-actions"><a class="btn primary" href="#/practice">专项练习</a></div>
    `, true);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openRelationEditor(moduleId) {
  const data = state.mindmapData;
  if (!data || data.module.id !== moduleId) {
    showToast("知识结构已经变化，请刷新地图后重试。", "error");
    return;
  }
  const options = data.nodes.map((node) => `<option value="${attr(node.id)}">${escapeHtml(node.title)}</option>`).join("");
  openModal("新增知识关系", `
    <form data-form="relation-add" data-module="${attr(moduleId)}">
      <label class="form-field"><span class="field-label">起点知识点</span><select name="from_kp_id">${options}</select></label>
      <label class="form-field"><span class="field-label">终点知识点</span><select name="to_kp_id">${options}</select></label>
      <label class="form-field"><span class="field-label">关系说明</span><input type="text" name="label" value="相关" maxlength="40"></label>
      <div class="form-actions"><button class="btn primary" type="submit">保存关系</button></div>
    </form>
  `);
}

async function openAiGenerator(options = {}) {
  const [settings, capabilities] = await Promise.all([
    api("/api/settings"),
    api("/api/generation/capabilities"),
  ]);
  const generatorModules = capabilities.modules;
  const moduleId = options.moduleId || generatorModules[0].module_id;
  const selectedModule = generatorModules.find((item) => item.module_id === moduleId) || generatorModules[0];
  const online = Boolean(settings.environment?.online);
  const kpOptions = selectedModule.knowledge_points.map((kp) => `<option value="${attr(kp.kp_id)}" ${kp.kp_id === options.kpId ? "selected" : ""}>${escapeHtml(kp.title)} · ${kp.blueprint_count} 套蓝图</option>`).join("");
  openModal("动态出题", `
    <div class="notice info"><strong>本地模板引擎默认可用，无需 API Key 或联网。</strong> 题目由课程资料和确定性规则生成，不是大模型输出；官方资料链接来自内置索引。</div>
    <form data-form="ai-generate">
      <input type="hidden" name="parent_id" value="${attr(options.parentId || "")}">
      <div class="form-row">
        <label class="form-field"><span class="field-label">模块</span><select name="module_id" id="ai-module">${generatorModules.map((m) => `<option value="${attr(m.module_id)}" ${m.module_id === moduleId ? "selected" : ""}>${escapeHtml(m.module_title)}</option>`).join("")}</select></label>
        <label class="form-field"><span class="field-label">知识点</span><select name="kp_id" id="ai-kp">${kpOptions}</select></label>
      </div>
      <div class="form-row three">
        <label class="form-field"><span class="field-label">生成引擎</span><select name="engine" id="generation-engine"><option value="local" selected>本地模板（无需配置）</option><option value="remote" ${settings.question_generation_engine === "remote" ? "selected" : ""} ${online ? "disabled" : ""}>远程模型（${online ? "在线版不可用" : "可选"}）</option></select></label>
        <label class="form-field"><span class="field-label">难度</span><select name="difficulty">${["入门", "基础", "进阶"].map((value) => `<option ${value === (options.difficulty || "基础") ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label class="form-field"><span class="field-label">生成数量</span><input type="number" name="count" min="1" max="10" value="3"></label>
      </div>
      <div id="engine-note" class="notice">${online ? "在线版会生成概念、选择、判断、填空、场景和面试题；内置 ACM 题可通过在线判题服务实际编译。" : "本地模式完全离线；进阶题会包含经过 Python/C++17 双语言评测的 ACM 题。"}</div>
      <div class="form-actions"><button class="btn primary" type="submit">生成并校验</button></div>
    </form>
  `);
  $("#ai-module").addEventListener("change", async (event) => {
    const module = generatorModules.find((item) => item.module_id === event.target.value);
    $("#ai-kp").innerHTML = (module?.knowledge_points || []).map((kp) => `<option value="${attr(kp.kp_id)}">${escapeHtml(kp.title)} · ${kp.blueprint_count} 套蓝图</option>`).join("");
  });
  $("#generation-engine").addEventListener("change", (event) => {
    $("#engine-note").className = "notice";
    $("#engine-note").textContent = event.target.value === "local"
      ? online
        ? "在线版会生成概念、选择、判断、填空、场景和面试题；内置 ACM 题可通过在线判题服务实际编译。"
        : "本地模式完全离线；进阶题会包含经过 Python/C++17 双语言评测的 ACM 题。"
      : settings.ai_api_key_configured
        ? "远程模型会消耗你的 API 额度，并优先尝试联网资料核验。"
        : "远程模型尚未配置。若请求失败，本次不会自动冒充成本地结果。";
  });
}

async function openEditQuestion(id) {
  const q = await api(`/api/questions/${encodeURIComponent(id)}?reveal=1`);
  const raw = {
    title: q.title,
    type: q.type,
    difficulty: q.difficulty,
    stem: q.stem,
    options: q.options || [],
    answer: q.answer || [],
    explanation_short: q.explanation_short || "",
    explanation: q.explanation || "",
    target: q.target || "",
    common_mistakes: q.common_mistakes || "",
    application: q.application || "",
    data: q.data || {},
    tests: q.tests || [],
  };
  openModal("编辑扩展题", `
    <div class="notice info">内置题不可编辑。保存时会重新执行结构、答案与重复指纹校验，并增加版本号。</div>
    <form data-form="question-edit" data-id="${attr(id)}">
      <label class="form-field"><span class="field-label">题目 JSON</span><textarea name="question" rows="22" required>${escapeHtml(JSON.stringify(raw, null, 2))}</textarea></label>
      <div class="form-actions"><button class="btn primary" type="submit">校验并保存</button></div>
    </form>
  `, true);
}

async function openQuestionImport() {
  const modules = await loadModules();
  const initial = await api(`/api/modules/${modules[0].id}`);
  openModal("导入单题", `
    <p>提交 JSON 对象。可选题型与字段要求会由服务端校验，重复题会被拒绝。</p>
    <form data-form="question-import">
      <div class="form-row">
        <label class="form-field"><span class="field-label">模块</span><select name="module_id" id="import-module">${modules.map((m) => `<option value="${attr(m.id)}">${escapeHtml(m.title)}</option>`).join("")}</select></label>
        <label class="form-field"><span class="field-label">知识点</span><select name="kp_id" id="import-kp">${initial.knowledge_points.map((kp) => `<option value="${attr(kp.id)}">${escapeHtml(kp.title)}</option>`).join("")}</select></label>
      </div>
      <label class="form-field"><span class="field-label">题目 JSON</span><textarea name="question" rows="16" required>${escapeHtml(JSON.stringify({ title: "示例题", type: "single_choice", difficulty: "基础", stem: "题干", options: [{ key: "A", text: "选项 A" }, { key: "B", text: "选项 B" }], answer: ["A"], explanation_short: "简要解析", explanation: "详细解析", target: "考查目标", common_mistakes: "易错点", application: "测试场景" }, null, 2))}</textarea></label>
      <div class="form-actions"><button class="btn primary" type="submit">校验并导入</button></div>
    </form>
  `, true);
  $("#import-module").addEventListener("change", async (event) => {
    const detail = await api(`/api/modules/${encodeURIComponent(event.target.value)}`);
    $("#import-kp").innerHTML = detail.knowledge_points.map((kp) => `<option value="${attr(kp.id)}">${escapeHtml(kp.title)}</option>`).join("");
  });
}

async function openCustomRun(questionId, language) {
  const code = $("#code-editor")?.value || "";
  openModal("自定义输入运行", `
    <form data-form="custom-run" data-id="${attr(questionId)}" data-lang="${attr(language)}">
      <label class="form-field"><span class="field-label">标准输入</span><textarea name="custom_input" rows="8" placeholder="输入会原样传给程序"></textarea></label>
      <div class="form-actions"><button class="btn primary" type="submit">执行并显示输出</button></div>
    </form>
  `);
  state.customCode = code;
}

async function openImportData() {
  openModal("导入学习数据", `
    <div class="notice">覆盖模式需要下方确认，会删除当前答题、错题、笔记、提交等学习记录。任何校验或写入错误都会整体回滚。</div>
    <form data-form="data-import">
      <label class="form-field"><span class="field-label">备份 JSON 文件</span><input type="file" name="backup_file" accept="application/json,.json" required></label>
      <label class="form-field"><span class="field-label">导入方式</span><select name="mode"><option value="merge">合并，不覆盖已有记录</option><option value="replace">覆盖当前学习数据</option></select></label>
      <label style="display:flex;gap:8px;align-items:flex-start;margin:12px 0"><input type="checkbox" name="confirm" value="1"> <span>我确认覆盖模式会替换现有学习记录</span></label>
      <div class="form-actions"><button class="btn danger" type="submit">校验并导入</button></div>
    </form>
  `);
}

async function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  // A button without its own action bubbles to the backdrop's close action.
  // Ignore that inherited action so form submit controls can submit normally.
  if (action === "close-modal" && target !== event.target) return;
  if (action === "close-modal") {
    closeModal();
    return;
  }
  if (action === "reload-page") {
    location.reload();
    return;
  }
  if (action === "open-daily-task") {
    event.preventDefault();
    state.dailyContext = { taskId: target.dataset.taskId, taskKind: target.dataset.kind };
    location.hash = `#/daily/${id}`;
    return;
  }
  if (action === "next-daily-task") {
    event.preventDefault();
    state.dailyContext = { taskId: target.dataset.taskId, taskKind: target.dataset.kind };
    location.hash = `#/daily/${id}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (action === "select-practice" || target.closest(".question-list-row[data-action='select-practice']")) {
    const row = target.closest("[data-id]");
    if (row) location.hash = `#/practice/${row.dataset.id}`;
    return;
  }
  if (action === "open-kp") {
    await openKnowledgePoint(id);
    return;
  }
  if (action === "new-note") {
    state.noteSelected = null;
    closeModal();
    location.hash = "#/notes";
    setTimeout(() => {
      const fields = document.querySelector("[data-form='note-save']");
      fields?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return;
  }
  if (action === "select-note") {
    state.noteSelected = id;
    await renderNotes();
    return;
  }
  if (action === "preview-note") {
    $("#note-preview").innerHTML = renderMarkdown($("#note-body")?.value || "");
    return;
  }
  if (action === "export-note") {
    const note = (await api("/api/notes")).notes.find((n) => n.id === id);
    if (note) download(`${note.title.replace(/[\\/:*?"<>|]/g, "_")}.md`, note.body, "text/markdown;charset=utf-8");
    return;
  }
  if (action === "delete-note") {
    if (!confirm("确认删除这篇笔记？删除后无法从平台内恢复。")) return;
    try {
      await api(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      state.noteSelected = null;
      showToast("笔记已删除。", "success");
      await renderNotes();
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "rebuild-tasks") {
    try {
      await api("/api/tasks/rebuild", { method: "POST", body: JSON.stringify({}) });
      showToast("已按当前设置重排未完成任务。", "success");
      await route();
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "reveal-question") {
    try {
      const q = await api(`/api/questions/${encodeURIComponent(id)}?reveal=1`);
      openModal(q.title, `
        <div class="notice">这是一条学习提示。正式作答时若仍查看完整解析，可在下方标记为“查看解析后完成”。</div>
        <h3>考查目标</h3><p>${escapeHtml(q.target)}</p>
        <h3>常见错误</h3><p>${escapeHtml(q.common_mistakes)}</p>
        <div class="markdown-body">${renderMarkdown(q.explanation_short)}</div>
        <div class="form-actions"><button class="btn" type="button" data-action="close-modal">继续独立作答</button></div>
      `);
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "note-from-question") {
    try {
      const q = await api(`/api/questions/${encodeURIComponent(id)}?reveal=1`);
      const body = `# ${q.title}\n\n## 题干\n\n${q.stem}\n\n## 我的理解\n\n\n## 易错点\n\n${q.common_mistakes}\n\n## 测试开发应用\n\n${q.application}\n`;
      await api("/api/notes", { method: "POST", body: JSON.stringify({ title: `${q.title} · 题目笔记`, body, question_id: q.id, module_id: q.module_id, kp_id: q.kp_id }) });
      showToast("题目笔记已创建。", "success");
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "edit-question") {
    try {
      await openEditQuestion(id);
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "delete-question") {
    if (!confirm(`确认删除或隐藏“${target.dataset.title || "这道题"}”？已有学习记录的题只会从题库隐藏。`)) return;
    try {
      const result = await api(`/api/questions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      });
      closeModal();
      showToast(result.message, "success");
      if (state.route[0] === "practice") await renderPractice();
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "regenerate-question") {
    const options = {
      parentId: id,
      moduleId: target.dataset.module,
      kpId: target.dataset.kp,
      difficulty: target.dataset.difficulty,
    };
    await openAiGenerator(options);
    return;
  }
  if (action === "create-variant") {
    try {
      target.disabled = true;
      const result = await api(`/api/reviews/${id}/variant`, { method: "POST", body: "{}" });
      showToast(result.reason, result.used_ai ? "success" : "");
      await renderReviews();
    } catch (error) { showToast(error.message, "error"); target.disabled = false; }
    return;
  }
  if (action === "open-ai-generator") {
    closeModal();
    await openAiGenerator();
    return;
  }
  if (action === "open-question-import") {
    closeModal();
    await openQuestionImport();
    return;
  }
  if (action === "open-import-data") {
    closeModal();
    await openImportData();
    return;
  }
  if (action === "export-data") {
    try {
      const payload = await api("/api/export");
      download(`testdev-learning-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
      showToast("学习数据已导出，API 密钥未包含。", "success");
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "clear-online-data") {
    if (!confirm("确认清空当前云端学习数据及浏览器缓存？建议先导出备份。")) return;
    try {
      await api("/api/local-data", {
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      });
      localStorage.removeItem("testdev-learning-online-v1");
      location.reload();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  if (action === "map-zoom") {
    state.mindmapZoom = Math.max(0.5, Math.min(1.5, state.mindmapZoom + Number(target.dataset.delta)));
    const canvas = $("#mindmap-canvas");
    if (canvas) canvas.style.transform = `scale(${state.mindmapZoom})`;
    return;
  }
  if (action === "map-reset") {
    state.mindmapZoom = 1;
    const canvas = $("#mindmap-canvas");
    if (canvas) canvas.style.transform = "scale(1)";
    return;
  }
  if (action === "add-relation") {
    openRelationEditor(target.dataset.module);
    return;
  }
  if (action === "delete-relation") {
    if (!confirm("确认删除这条自建知识关系？")) return;
    try {
      await api(`/api/mindmap/edges/${id}`, { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      showToast("知识关系已删除。", "success");
      await renderMap(state.mindmapData?.module?.id);
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "acm-language") {
    const editor = $("#code-editor");
    const oldLang = target.closest(".lang-switch")?.querySelector("button.active")?.dataset.lang;
    if (editor && oldLang) {
      state.acmCode[id] = { ...(state.acmCode[id] || {}), [oldLang]: editor.value };
      try { await api("/api/drafts", { method: "POST", body: JSON.stringify({ question_id: id, language: oldLang, code: editor.value }) }); } catch {}
    }
    state.acmLanguage[id] = target.dataset.lang;
    await renderAcm(id);
    return;
  }
  if (action === "save-draft") {
    try {
      await api("/api/drafts", { method: "POST", body: JSON.stringify({ question_id: id, language: target.dataset.lang, code: $("#code-editor").value }) });
      showToast("草稿已保存到数据库。", "success");
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "judge-run") {
    const editor = $("#code-editor");
    const mode = target.dataset.mode;
    try {
      target.disabled = true;
      target.textContent = mode === "submit" ? "评测中…" : "运行中…";
      await api("/api/drafts", { method: "POST", body: JSON.stringify({ question_id: id, language: target.dataset.lang, code: editor.value }) });
      const result = await api("/api/judge", { method: "POST", body: JSON.stringify({
        question_id: id,
        language: target.dataset.lang,
        code: editor.value,
        run_mode: mode,
        task_id: target.dataset.task || null,
        task_kind: target.dataset.kind || null,
        viewed_solution: Boolean(state.acmReveal?.[id]),
      }) });
      state.acmResult[id] = result;
      $("#judge-output").innerHTML = judgeHtml(result);
      if (mode === "submit" && result.status === "ACCEPTED") {
        showToast("全部测试通过，提交记录已保存。", "success");
      } else if (mode === "submit") {
        showToast(`评测结果：${result.status}`, "error");
      }
      if (mode === "submit") {
        await renderAcm(id);
      }
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      target.disabled = false;
      target.textContent = mode === "submit" ? "正式提交" : "运行样例";
    }
    return;
  }
  if (action === "custom-run") {
    await openCustomRun(id, target.dataset.lang);
    return;
  }
  if (action === "reveal-acm") {
    if (!confirm("查看参考答案会记录为“查看解析后完成”，该次提交不会增加独立掌握度。是否继续？")) return;
    state.acmReveal = { ...(state.acmReveal || {}), [id]: true };
    await renderAcm(id);
    return;
  }
  if (action === "start-interview") {
    try {
      const result = await api("/api/interviews", { method: "POST", body: JSON.stringify({ count: 6 }) });
      state.activeInterview = { ...result, answers: [] };
      await renderInterview();
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "open-interview") {
    const result = await api("/api/interviews");
    state.activeInterview = result.interviews.find((item) => item.id === id);
    await renderInterview();
    return;
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const data = new FormData(form);
  const submitter = event.submitter;
  try {
    if (kind === "answer") {
      const answerElements = [...form.querySelectorAll("input[name='answer']:checked")].map((el) => el.value);
      const textAnswer = form.querySelector("textarea[name='answer'], input[name='answer']:not([type='radio']):not([type='checkbox'])")?.value || "";
      const isChoice = answerElements.length > 0;
      const questionId = form.dataset.questionId;
      const taskKind = data.get("task_kind");
      const result = await api("/api/attempts", { method: "POST", body: JSON.stringify({
        question_id: questionId,
        answer: isChoice ? answerElements : textAnswer,
        task_id: data.get("task_id") || null,
        task_kind: taskKind || null,
        mode: taskKind === "review" ? "review" : "new",
      }) });
      $("#answer-feedback").innerHTML = answerResultHtml(result);
      if (result.is_correct !== null) showToast(result.is_correct ? "答案已保存并判定通过。" : "答案已保存，已加入复习队列。", result.is_correct ? "success" : "");
      await checkHealth();
      return;
    }
    if (kind === "self-review") {
      const result = await api(`/api/attempts/${form.dataset.attemptId}/review`, { method: "POST", body: JSON.stringify({
        self_score: Number(data.get("self_score")),
        self_review: data.get("self_review"),
        error_category: data.get("error_category"),
      }) });
      showToast(result.message, "success");
      form.outerHTML = `<div class="notice info">${escapeHtml(result.message)}</div>`;
      return;
    }
    if (kind === "practice-filter") {
      for (const key of Object.keys(state.practiceFilters)) state.practiceFilters[key] = data.get(key) || "";
      state.practiceSelected = null;
      await renderPractice();
      return;
    }
    if (kind === "notes-search") {
      state.noteSearch = String(data.get("q") || "").trim();
      state.noteSelected = null;
      await renderNotes();
      return;
    }
    if (kind === "relation-add") {
      await api(`/api/mindmap/${encodeURIComponent(form.dataset.module)}/edges`, {
        method: "POST",
        body: JSON.stringify({
          from_kp_id: data.get("from_kp_id"),
          to_kp_id: data.get("to_kp_id"),
          label: data.get("label"),
        }),
      });
      closeModal();
      showToast("知识关系已保存。", "success");
      await renderMap(form.dataset.module);
      return;
    }
    if (kind === "note-save") {
      const payload = { title: data.get("title"), body: data.get("body"), favorite: data.get("favorite") === "1" };
      const result = form.dataset.id
        ? await api(`/api/notes/${encodeURIComponent(form.dataset.id)}`, { method: "PUT", body: JSON.stringify(payload) })
        : await api("/api/notes", { method: "POST", body: JSON.stringify(payload) });
      state.noteSelected = result.note.id;
      showToast("笔记已保存。", "success");
      await renderNotes();
      return;
    }
    if (kind === "milestone") {
      await api(`/api/milestones/${encodeURIComponent(form.dataset.id)}`, { method: "PUT", body: JSON.stringify({ status: data.get("status"), evidence: data.get("evidence") }) });
      showToast("里程碑已保存。", "success");
      await renderProject();
      return;
    }
    if (kind === "settings-basic") {
      const intervals = String(data.get("review_intervals")).split(",").map((x) => Number(x.trim())).filter(Boolean);
      const payload = {
        daily_question_target: Number(data.get("daily_question_target")),
        review_intervals: intervals,
      };
      if (data.get("daily_time_budget_minutes")) payload.daily_time_budget_minutes = Number(data.get("daily_time_budget_minutes"));
      if (data.get("new_question_ratio")) payload.new_question_ratio = Number(data.get("new_question_ratio"));
      await api("/api/settings", { method: "POST", body: JSON.stringify(payload) });
      showToast("学习节奏已保存，今日未完成任务已重排。", "success");
      await renderSettings();
      return;
    }
    if (kind === "settings-thresholds") {
      const thresholds = {};
      for (const level of ["入门", "掌握", "熟练", "精通"]) {
        thresholds[level] = {
          accuracy: Number(data.get(`acc_${level}`)),
          distinct: Number(data.get(`dist_${level}`)),
          coverage: Number(data.get(`cov_${level}`)),
        };
      }
      await api("/api/settings", { method: "POST", body: JSON.stringify({ mastery_thresholds: thresholds }) });
      showToast("晋级阈值已保存。", "success");
      await renderSettings();
      return;
    }
    if (kind === "settings-ai") {
      const payload = {
        ai_base_url: data.get("ai_base_url"),
        ai_model: data.get("ai_model"),
        ai_timeout_seconds: Number(data.get("ai_timeout_seconds")),
        question_generation_engine: data.get("question_generation_engine"),
      };
      if (data.get("ai_api_key")) payload.ai_api_key = data.get("ai_api_key");
      if (data.get("tavily_api_key")) payload.tavily_api_key = data.get("tavily_api_key");
      await api("/api/settings", { method: "POST", body: JSON.stringify(payload) });
      showToast("模型配置已保存到服务端。", "success");
      await renderSettings();
      return;
    }
    if (kind === "ai-generate") {
      const button = submitter || form.querySelector("button[type='submit']");
      if (button) { button.disabled = true; button.textContent = "生成与校验中…"; }
      const result = await api("/api/generate", { method: "POST", body: JSON.stringify({
        module_id: data.get("module_id"),
        kp_id: data.get("kp_id"),
        difficulty: data.get("difficulty"),
        count: Number(data.get("count")),
        parent_id: data.get("parent_id") || null,
        engine: data.get("engine") || "local",
      }) });
      const sourceRows = (result.sources || []).map((source) => `<li><a class="text-link" href="${attr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><br><small>${escapeHtml(source.retrieved_at || source.verification || "内置资料索引")} · ${escapeHtml(source.kind || "来源")}</small></li>`).join("");
      const acceptedRows = (result.accepted || []).map((item) => `
        <div class="review-card">
          <span class="pill">${escapeHtml(item.type)} · ${escapeHtml(item.difficulty)}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>审核状态：${escapeHtml(item.validation_status)}</p>
          <div class="form-actions">
            <button class="btn small" type="button" data-action="edit-question" data-id="${attr(item.id)}">编辑</button>
            <button class="btn small danger" type="button" data-action="delete-question" data-id="${attr(item.id)}" data-title="${attr(item.title)}">删除</button>
            <button class="btn small" type="button" data-action="regenerate-question" data-id="${attr(item.id)}" data-module="${attr(item.module_id)}" data-kp="${attr(item.kp_id)}" data-difficulty="${attr(item.difficulty)}">重新生成</button>
          </div>
        </div>
      `).join("");
      openModal("动态出题结果", `
        <div class="metric-grid">
          <div class="metric-box"><strong>${result.accepted_count}</strong><small>新增题目</small></div>
          <div class="metric-box"><strong>${result.failed_count}</strong><small>校验失败</small></div>
          <div class="metric-box"><strong>${result.duplicate_count}</strong><small>重复拒绝</small></div>
        </div>
        <p><span class="pill orange">${escapeHtml(result.engine_label || (result.engine === "local" ? "本地模板引擎" : "远程模型"))}</span> ${result.requires_network === false ? "完全离线完成" : "使用远程服务"}</p>
        <div class="notice ${result.network_verified ? "info" : ""}" style="margin-top:14px">${escapeHtml(result.notice)}</div>
        <h3>新增题目</h3>
        <div class="review-grid">${acceptedRows || '<div class="empty-state">没有题目通过校验</div>'}</div>
        <h3>${result.engine === "local" ? "官方资料索引" : "联网来源"}</h3>
        ${sourceRows ? `<ul>${sourceRows}</ul>` : `<div class="notice">本次没有可记录的联网核实来源；系统不会伪造引用。</div>`}
        ${(result.rejected || []).length ? `<h3>拒绝明细</h3><ul>${result.rejected.map((item) => `<li>${escapeHtml(item.title || "未命名")}：${escapeHtml(item.reason)}</li>`).join("")}</ul>` : ""}
        <div class="form-actions"><button class="btn" type="button" data-action="close-modal">关闭</button><a class="btn primary" href="#/practice" data-action="close-modal">去题库查看</a></div>
      `, true);
      showToast(`新增 ${result.accepted_count} 道，失败 ${result.failed_count} 道，重复拒绝 ${result.duplicate_count} 道。`, "success");
      state.modules = null;
      return;
    }
    if (kind === "question-import") {
      let question;
      try { question = JSON.parse(data.get("question")); } catch { throw new Error("题目 JSON 无法解析。"); }
      const result = await api("/api/questions/import", { method: "POST", body: JSON.stringify({ module_id: data.get("module_id"), kp_id: data.get("kp_id"), question }) });
      closeModal();
      showToast(`已导入：${result.question.title}`, "success");
      if (state.route[0] === "practice") await renderPractice();
      return;
    }
    if (kind === "question-edit") {
      let question;
      try { question = JSON.parse(data.get("question")); } catch { throw new Error("题目 JSON 无法解析。"); }
      await api(`/api/questions/${encodeURIComponent(form.dataset.id)}`, {
        method: "PUT",
        body: JSON.stringify({ question }),
      });
      closeModal();
      showToast("扩展题已校验并保存。", "success");
      if (state.route[0] === "practice") await renderPractice(form.dataset.id);
      return;
    }
    if (kind === "custom-run") {
      const code = state.customCode || $("#code-editor")?.value || "";
      const result = await api("/api/judge", { method: "POST", body: JSON.stringify({ question_id: form.dataset.id, language: form.dataset.lang, code, run_mode: "custom", custom_input: data.get("custom_input") }) });
      closeModal();
      state.acmResult[form.dataset.id] = result;
      $("#judge-output").innerHTML = judgeHtml(result);
      showToast(result.message, result.status === "CUSTOM_RUN" ? "success" : "error");
      return;
    }
    if (kind === "interview-save") {
      const active = state.activeInterview;
      const answers = active.questions.map((q, index) => ({
        question_id: q.id,
        answer: data.get(`answer_${index}`),
        self_score: Number(data.get(`score_${index}`) || 0),
      }));
      const finish = submitter?.value === "1";
      const result = await api(`/api/interviews/${encodeURIComponent(form.dataset.id)}`, { method: "PUT", body: JSON.stringify({ answers, finish }) });
      state.activeInterview.answers = answers;
      showToast(finish ? `模拟面试已完成，自评平均 ${result.score} 分。` : "模拟面试进度已保存。", "success");
      if (finish) state.activeInterview = null;
      await renderInterview();
      return;
    }
    if (kind === "data-import") {
      const file = data.get("backup_file");
      if (!file || !file.size) throw new Error("请选择备份文件。");
      let backup;
      try { backup = JSON.parse(await file.text()); } catch { throw new Error("备份文件不是合法 JSON。"); }
      const result = await api("/api/import", { method: "POST", body: JSON.stringify({ backup, mode: data.get("mode"), confirm: data.get("confirm") === "1" }) });
      if (!result.ok) throw new Error((result.errors || []).join("；"));
      closeModal();
      showToast(`已导入 ${result.imported} 条记录。`, "success");
      state.modules = null;
      await route();
      return;
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("click", (event) => {
  handleClick(event).catch((error) => showToast(error.message, "error"));
});

document.addEventListener("submit", (event) => {
  handleSubmit(event).catch((error) => showToast(error.message, "error"));
});

document.addEventListener("change", (event) => {
  if (event.target.name === "answer" && event.target.type === "radio") {
    const group = event.target.closest(".answer-area");
    group?.querySelectorAll(".option-row").forEach((row) => row.classList.toggle("selected", row.querySelector("input")?.checked));
  }
  if (event.target.type === "checkbox" && event.target.name === "answer") {
    event.target.closest(".option-row")?.classList.toggle("selected", event.target.checked);
  }
});

document.addEventListener("keydown", (event) => {
  const row = event.target.closest(".question-list-row[data-action='select-practice']");
  if (row && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    location.hash = `#/practice/${row.dataset.id}`;
  }
  if (event.target.id === "code-editor" && event.key === "Tab") {
    event.preventDefault();
    const start = event.target.selectionStart;
    const end = event.target.selectionEnd;
    event.target.value = `${event.target.value.slice(0, start)}    ${event.target.value.slice(end)}`;
    event.target.selectionStart = event.target.selectionEnd = start + 4;
  }
});

$("#menu-toggle").addEventListener("click", () => document.body.classList.add("menu-open"));
$("#mobile-scrim").addEventListener("click", closeMenu);

async function init() {
  const todayLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date());
  $("#today-label").textContent = todayLabel;
  await checkHealth();
  try {
    const dashboard = await api("/api/dashboard");
    $("#side-phase").textContent = dashboard.phase?.title || "计划准备";
    const navDue = $("#nav-due");
    navDue.hidden = !dashboard.due_reviews;
    navDue.textContent = dashboard.due_reviews;
  } catch {}
  await route();
  window.addEventListener("hashchange", route);
}

init();

