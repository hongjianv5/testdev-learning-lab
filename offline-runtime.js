(() => {
  "use strict";

  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  const pageParams = new URLSearchParams(location.search);
  const forceStaticPreview = pageParams.has("offline") || pageParams.has("static");
  const isGitHubPages = location.hostname.endsWith(".github.io");
  const isStaticTunnel = location.hostname.endsWith(".lhr.life") ||
    location.hostname.endsWith(".trycloudflare.com") ||
    location.hostname.endsWith(".pagey.site") ||
    location.hostname === "html.cafe";
  const onlineMode = forceStaticPreview || !localHosts.has(location.hostname);
  if (!onlineMode) return;

  const nativeFetch = window.fetch.bind(window);
  const STATE_KEY = "testdev-learning-online-v1";
  const CLOUD_KEY_STORAGE = "testdev-cloud-access-key";
  const CLOUD_STATE_ENDPOINT = "/.netlify/functions/cloud-state";
  const ONLINE_JUDGE_ENDPOINT = "/.netlify/functions/online-judge";
  const useCloud = !forceStaticPreview && !isGitHubPages && !isStaticTunnel;
  const LEVELS = ["入门", "掌握", "熟练", "精通"];
  const TYPE_MINUTES = {
    acm: 25, test_plan: 20, test_case_design: 15, scenario: 12, interview: 10,
    code_fix: 8, code_reading: 6, output_prediction: 5, multiple_choice: 5,
    single_choice: 4, true_false: 3, fill_blank: 4,
  };
  const MANUAL_TYPES = new Set(["test_case_design", "test_plan", "interview", "scenario"]);
  const contexts = [
    ["接口回归评审", "团队正在评审一次接口回归用例，需要先明确概念边界。"],
    ["休闲游戏版本测试", "活动版本即将上线，测试同学需要把理论应用到真实游戏场景。"],
    ["线上故障分析", "日志和多端状态出现差异，需要从原理出发判断根因。"],
    ["项目面试复盘", "面试官要求你解释项目中的选择、边界和验证依据。"],
    ["CI 失败定位", "自动化在持续集成中偶发失败，需要区分环境、数据和代码问题。"],
  ];
  const archetypes = ["概念定位", "错误识别", "实践选择", "关系辨析", "术语补全", "面试表达"];

  let seed = null;
  let db = null;
  let nextId = 1;
  let cloudKey = "";
  let cloudRevision = 0;
  let cloudReady = false;
  let syncQueue = Promise.resolve();

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const localDate = (date = new Date()) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
  const uuid = () =>
    globalThis.crypto?.randomUUID?.() || `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hash = (value) => {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, "0");
  };
  const today = () => localDate();
  const nextDue = (days, base = today()) => {
    const date = new Date(`${base}T12:00:00+08:00`);
    date.setDate(date.getDate() + Math.max(1, Number(days)));
    return localDate(date);
  };

  function save() {
    db.revision = (db.revision || 0) + 1;
    localStorage.setItem(STATE_KEY, JSON.stringify(db));
    queueCloudSave();
  }

  function initialState(data) {
    return {
      revision: 0,
      settings: { ...data.settings, question_generation_engine: "local" },
      attempts: [],
      reviews: [],
      dailyTasks: [],
      notes: [],
      drafts: [],
      submissions: [],
      levelSnapshots: [],
      project: clone(data.project),
      milestones: clone(data.milestones),
      interviews: [],
      customQuestions: [],
      edges: clone(data.edges),
      generations: [],
    };
  }

  function validState(value) {
    return value && value.version === 1 && Array.isArray(value.attempts);
  }

  function setCloudStatus(text, failed = false) {
    const node = document.getElementById("cloud-sync-status");
    if (!node) return;
    node.textContent = text;
    node.style.color = failed ? "var(--danger)" : "";
  }

  function requestCloudKey(errorMessage = "") {
    const gate = document.getElementById("cloud-gate");
    const form = document.getElementById("cloud-gate-form");
    const input = document.getElementById("cloud-access-key");
    const error = document.getElementById("cloud-gate-error");
    if (!gate || !form || !input || !error) {
      return Promise.reject(new Error("云端登录界面加载失败。"));
    }
    error.textContent = errorMessage;
    gate.hidden = false;
    input.focus();
    return new Promise((resolve) => {
      const onSubmit = (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) {
          error.textContent = "请输入访问密码。";
          return;
        }
        form.removeEventListener("submit", onSubmit);
        gate.hidden = true;
        resolve(value);
      };
      form.addEventListener("submit", onSubmit);
    });
  }

  async function cloudRequest(url, init = {}) {
    return nativeFetch(url, {
      ...init,
      headers: {
        "X-TestDev-Key": cloudKey,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  }

  async function loadCloudState() {
    let errorMessage = "";
    while (true) {
      cloudKey = sessionStorage.getItem(CLOUD_KEY_STORAGE) || "";
      if (!cloudKey) cloudKey = await requestCloudKey(errorMessage);
      sessionStorage.setItem(CLOUD_KEY_STORAGE, cloudKey);
      setCloudStatus("正在读取云端记录");
      let response;
      try {
        response = await cloudRequest(CLOUD_STATE_ENDPOINT, { cache: "no-store" });
      } catch (error) {
        throw new Error(`无法连接云端服务：${error.message}`);
      }
      if (response.status === 401) {
        sessionStorage.removeItem(CLOUD_KEY_STORAGE);
        cloudKey = "";
        errorMessage = "访问密码不正确，请重新输入。";
        continue;
      }
      let payload = {};
      try { payload = await response.json(); }
      catch { throw new Error("云端服务返回了无法解析的响应。"); }
      if (!response.ok) throw new Error(payload.error || `云端服务错误（HTTP ${response.status}）。`);
      cloudRevision = Number(payload.revision || 0);
      return payload.state;
    }
  }

  function queueCloudSave() {
    if (!useCloud || !cloudReady || !cloudKey) return;
    const snapshot = clone(db);
    setCloudStatus("正在同步");
    syncQueue = syncQueue.catch(() => undefined).then(async () => {
      try {
        const response = await cloudRequest(CLOUD_STATE_ENDPOINT, {
          method: "PUT",
          body: JSON.stringify({ state: snapshot, base_revision: cloudRevision }),
        });
        const payload = await response.json();
        if (response.status === 409) {
          setCloudStatus("同步冲突，请刷新", true);
          if (typeof window.showToast === "function") {
            window.showToast("云端记录已在其他页面更新。请先导出当前记录，再刷新页面。", "error");
          }
          return;
        }
        if (!response.ok) throw new Error(payload.error || "云端同步失败。");
        cloudRevision = Number(payload.revision || cloudRevision);
        setCloudStatus("云端已同步");
      } catch (error) {
        console.warn("cloud sync failed", error);
        setCloudStatus("云端暂不可用，已保存在浏览器", true);
      }
    });
  }

  async function initialize() {
    const embeddedSeed = document.getElementById("testdev-seed");
    if (window.__TESTDEV_SEED__) {
      seed = window.__TESTDEV_SEED__;
    } else if (embeddedSeed) {
      seed = JSON.parse(embeddedSeed.textContent || "null");
      if (!seed) throw new Error("页面内置课程数据为空。");
    } else {
      const response = await nativeFetch("./offline-data.json", { cache: "no-store" });
      if (!response.ok) throw new Error("在线课程数据加载失败。");
      seed = await response.json();
    }
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    } catch {
      localStorage.setItem(`${STATE_KEY}-corrupt-backup-${Date.now()}`, localStorage.getItem(STATE_KEY) || "");
    }
    db = validState(saved) ? saved : initialState(seed);
    let cloudState = null;
    if (useCloud) {
      try {
        cloudState = await loadCloudState();
      } catch (error) {
        setCloudStatus("云端连接失败", true);
        throw error;
      }
      db = validState(cloudState) ? cloudState : initialState(seed);
      cloudReady = true;
    }
    db.version = 1;
    db.settings = { ...seed.settings, ...(db.settings || {}) };
    const numericIds = [
      ...(db.attempts || []), ...(db.reviews || []), ...(db.dailyTasks || []),
      ...(db.levelSnapshots || []), ...(db.generations || []),
    ].map((item) => Number(item.id)).filter(Number.isFinite);
    nextId = Math.max(0, ...numericIds) + 1;
    localStorage.setItem(STATE_KEY, JSON.stringify(db));
    if (useCloud) {
      if (cloudState) setCloudStatus("云端已同步");
      else {
        cloudReady = true;
        queueCloudSave();
      }
    }
  }

  const ready = initialize().catch((error) => {
    window.__TESTDEV_INIT_ERROR__ = String(error?.stack || error);
    console.error(error);
    const view = document.getElementById("view");
    if (view) {
      view.innerHTML = '<div class="loading-block"><strong>学习数据初始化失败</strong><p></p></div>';
      const message = view.querySelector("p");
      if (message) message.textContent = error?.message || String(error);
    }
    throw error;
  });

  function allQuestions() {
    return [...seed.questions, ...(db.customQuestions || [])];
  }

  function questionById(id) {
    return allQuestions().find((question) => question.id === id);
  }

  function moduleById(id) {
    return seed.modules.find((module) => module.id === id);
  }

  function pointById(id) {
    return seed.knowledge_points.find((point) => point.id === id);
  }

  function safeQuestion(question, reveal = false) {
    const data = clone(question.data || {});
    if (!reveal && data.acm) {
      delete data.acm.reference_python;
      delete data.acm.reference_cpp;
    }
    const result = {
      id: question.id,
      logical_id: question.logical_id,
      module_id: question.module_id,
      kp_id: question.kp_id,
      title: question.title,
      type: question.type,
      difficulty: question.difficulty,
      stem: question.stem,
      options: data.options || [],
      acm: data.acm,
      data,
      source_type: question.source_type,
      validation_status: question.validation_status,
      version: question.version || 1,
      comprehensive: Boolean(question.comprehensive),
      created_at: question.created_at,
      updated_at: question.updated_at,
    };
    if (reveal) {
      result.answer = clone(question.answer || []);
      result.explanation_short = question.explanation_short;
      result.explanation = question.explanation;
      result.target = question.target;
      result.common_mistakes = question.common_mistakes;
      result.application = question.application;
      result.reference_url = question.reference_url || "";
      if (question.type === "acm") result.tests = clone(question.tests || []);
    }
    return result;
  }

  function normalize(value) {
    return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
  }

  function grade(question, answer) {
    if (MANUAL_TYPES.has(question.type)) {
      if (answer && typeof answer === "object" && answer.self_score !== undefined && answer.self_score !== null) {
        const score = Math.max(0, Math.min(100, Number(answer.self_score)));
        return {
          is_correct: score >= 60, score, status: "graded_by_self_review",
          message: "已按自评标准记录；该结果会与自动判分区分展示。",
        };
      }
      return { is_correct: null, score: null, status: "manual_required", message: "开放题已保存，请对照评分标准完成自评。" };
    }
    const value = answer && typeof answer === "object" && !Array.isArray(answer) ? answer.answer : answer;
    const expected = question.answer || [];
    let correct;
    if (["single_choice", "multiple_choice"].includes(question.type)) {
      const given = new Set((Array.isArray(value) ? value : [value]).map((item) => normalize(item).toUpperCase()));
      const wanted = new Set(expected.map((item) => normalize(item).toUpperCase()));
      correct = given.size === wanted.size && [...wanted].every((item) => given.has(item));
    } else {
      const accepted = expected.map(normalize);
      const given = Array.isArray(value) ? value.map(normalize) : [normalize(value)];
      correct = given.some((item) => item && accepted.includes(item));
    }
    return {
      is_correct: correct,
      score: correct ? 100 : 0,
      status: "auto_graded",
      message: correct ? "回答正确。" : "回答不正确，请先根据反馈定位错误。",
    };
  }

  function currentPhase(day = today()) {
    const phase = seed.phases.find((item) => item.start_date <= day && item.end_date >= day);
    if (phase) return phase;
    if (day < "2026-11-01") {
      return {
        id: "preview", position: 0, title: "开营准备", start_date: "2026-11-01",
        end_date: "2026-11-30", theme: "先用入门题熟悉平台，正式计划 11 月 1 日开始",
        outcomes: ["完成环境自检", "体验一次答题与代码提交"],
      };
    }
    return {
      id: "post", position: 8, title: "验收与复盘", start_date: "2027-03-01",
      end_date: "2027-03-01", theme: "依据真实数据完成总结与后续计划",
      outcomes: ["查看转岗就绪度", "识别最优先补习项"],
    };
  }

  const moduleOrderByPhase = {
    "phase-1": ["python", "testing", "algorithms", "engineering", "cpp"],
    "phase-2": ["python", "cpp", "algorithms", "testing", "automation"],
    "phase-3": ["automation", "api_db", "cpp", "algorithms", "python", "engineering", "unity"],
    "phase-4": ["project", "automation", "python", "cpp", "testing", "interview"],
    "phase-5": ["project", "interview", "automation", "testing", "python", "cpp"],
    "phase-6": ["interview", "algorithms", "testing", "automation", "python", "cpp"],
  };

  function buildTaskPlan(day = today(), targetOverride, ratioOverride, budgetOverride) {
    const target = Math.max(1, Number(targetOverride || db.settings.daily_question_target || 10));
    const ratio = Math.max(0, Math.min(1, Number(ratioOverride ?? db.settings.new_question_ratio ?? 0.6)));
    const budget = Math.max(15, Number(budgetOverride || db.settings.daily_time_budget_minutes || 90));
    const phase = currentPhase(day);
    const order = moduleOrderByPhase[phase.id] || ["python", "testing", "algorithms"];
    const all = allQuestions().filter((question) => question.type !== "acm");
    const attempted = new Set(db.attempts.map((attempt) => attempt.question_id));
    const attemptedToday = new Set(db.attempts.filter((a) => a.created_at.slice(0, 10) === day).map((a) => a.question_id));
    const best = new Map();
    for (const attempt of db.attempts) {
      const previous = best.get(attempt.question_id);
      best.set(attempt.question_id, {
        correct: Boolean(attempt.is_correct) || Boolean(previous?.correct),
      });
    }
    const sortQuestion = (left, right) => {
      const lo = order.indexOf(left.module_id);
      const ro = order.indexOf(right.module_id);
      return (lo < 0 ? 99 : lo) - (ro < 0 ? 99 : ro);
    };
    let existing = db.dailyTasks.filter((task) => task.task_date === day);
    const completed = existing.filter((task) => task.completed);
    let incomplete = existing.filter((task) => !task.completed);
    const finalTarget = Math.max(target, completed.length);
    const keepIncomplete = incomplete.slice(0, Math.max(0, finalTarget - completed.length));
    existing = [...completed, ...keepIncomplete];
    const existingIds = new Set(existing.map((task) => task.question_id));
    const newPool = all.filter((q) => !attempted.has(q.id) && !existingIds.has(q.id)).sort(sortQuestion);
    const reviewMap = new Map(db.reviews.filter((review) => review.status === "active").map((review) => [review.question_id, review]));
    const reviewPool = all
      .filter((q) => !attemptedToday.has(q.id) && !existingIds.has(q.id))
      .filter((q) => {
        const review = reviewMap.get(q.id);
        return (review && review.due_date <= day) || (best.has(q.id) && !best.get(q.id).correct);
      })
      .sort((a, b) => {
        const ad = reviewMap.get(a.id)?.due_date <= day ? 0 : 1;
        const bd = reviewMap.get(b.id)?.due_date <= day ? 0 : 1;
        return ad - bd || sortQuestion(a, b);
      });
    newPool.splice(0, newPool.length, ...newPool.filter((q) => !reviewMap.has(q.id)));
    const needed = finalTarget - existing.length;
    const desiredNew = Math.min(newPool.length, Math.round(needed * ratio));
    const desiredReviews = Math.min(reviewPool.length, needed - desiredNew);
    const tasks = [];
    for (let i = 0; i < Math.max(desiredNew, desiredReviews); i += 1) {
      if (i < desiredReviews) tasks.push({ question: reviewPool[i], kind: "review" });
      if (i < desiredNew) tasks.push({ question: newPool[i], kind: "new" });
    }
    if (needed >= 2 && newPool.length && !tasks.some((task) => task.kind === "new")) tasks.unshift({ question: newPool[0], kind: "new" });
    if (needed >= 2 && reviewPool.length && !tasks.some((task) => task.kind === "review")) tasks.push({ question: reviewPool[0], kind: "review" });
    const usedForTasks = new Set(tasks.map((task) => task.question.id));
    for (const question of [...reviewPool, ...newPool]) {
      if (tasks.length >= needed) break;
      if (usedForTasks.has(question.id)) continue;
      tasks.push({ question, kind: reviewPool.some((item) => item.id === question.id) ? "review" : "new" });
      usedForTasks.add(question.id);
    }
    let elapsed = existing.reduce((total, task) => total + (task.estimated_minutes || TYPE_MINUTES[task.type] || 8), 0);
    const maxPosition = existing.reduce((max, task) => Math.max(max, task.position || 0), 0);
    let position = maxPosition;
    for (const item of tasks) {
      if (existing.length >= finalTarget) break;
      const minutes = TYPE_MINUTES[item.question.type] || 8;
      if (existing.length + 1 > Math.max(1, completed.length) && elapsed + minutes > budget) continue;
      position += 1;
      const task = {
        id: nextId++, task_date: day, position, question_id: item.question.id,
        kind: item.kind, reason: item.kind === "review" ? "到期或薄弱知识点复习" : `当前阶段新知识 · ${item.question.difficulty}`,
        completed: false, completed_at: null, created_at: now(), title: item.question.title,
        type: item.question.type, difficulty: item.question.difficulty, module_id: item.question.module_id,
        estimated_minutes: minutes,
      };
      existing.push(task);
      elapsed += minutes;
    }
    db.dailyTasks = [...db.dailyTasks.filter((task) => task.task_date !== day), ...existing];
    save();
    return taskSummary(day, target, budget);
  }

  function taskSummary(day, target, budget) {
    const tasks = db.dailyTasks.filter((task) => task.task_date === day).sort((a, b) => a.position - b.position);
    const completed = tasks.filter((task) => task.completed).length;
    const newCount = tasks.filter((task) => task.kind === "new").length;
    const enrichedTasks = tasks.map((task) => {
      const question = questionById(task.question_id);
      const point = question ? pointById(question.kp_id) : null;
      return { ...task, kp_id: question?.kp_id || null, kp_title: point?.title || "" };
    });
    return {
      date: day, target, total: tasks.length, completed, remaining: tasks.length - completed,
      new_count: newCount, review_count: tasks.length - newCount,
      estimated_minutes: tasks.reduce((sum, task) => sum + (task.estimated_minutes || 8), 0),
      remaining_minutes: tasks.filter((task) => !task.completed).reduce((sum, task) => sum + (task.estimated_minutes || 8), 0),
      time_budget_minutes: budget,
      tasks: enrichedTasks,
      shortage: tasks.length < target ? [`当前可用题库不足，目标 ${target} 道，实际安排 ${tasks.length} 道。`] : [],
    };
  }

  function evalMastery(moduleId) {
    const questions = allQuestions().filter((q) => q.module_id === moduleId);
    const qmap = new Map(questions.map((q) => [q.id, q]));
    const logical = new Map();
    questions.forEach((q) => logical.set(q.logical_id, q));
    const independent = new Map();
    for (const attempt of db.attempts) {
      if (attempt.viewed_solution || !qmap.has(attempt.question_id)) continue;
      const q = qmap.get(attempt.question_id);
      const previous = independent.get(q.logical_id);
      if (!previous || previous.created_at <= attempt.created_at) independent.set(q.logical_id, attempt);
    }
    const records = [...independent.values()];
    const correct = records.filter((attempt) => attempt.is_correct);
    const accuracy = records.length ? correct.length / records.length : 0;
    const passedKps = new Set(correct.map((attempt) => qmap.get(attempt.question_id).kp_id));
    const totalKps = new Set(questions.map((q) => q.kp_id));
    const coverage = totalKps.size ? passedKps.size / totalKps.size : 0;
    const practice = new Set(correct.filter((attempt) => {
      const q = qmap.get(attempt.question_id);
      return q.comprehensive || ["project", "scenario", "acm"].includes(q.type);
    }).map((attempt) => qmap.get(attempt.question_id).logical_id));
    let languageOk = true;
    if (moduleId === "python" || moduleId === "cpp") {
      languageOk = correct.some((attempt) => {
        const q = qmap.get(attempt.question_id);
        return q.type === "acm" && attempt.language === moduleId;
      });
    }
    const thresholds = db.settings.mastery_thresholds;
    let eligible = null;
    let unmet = [];
    for (const level of LEVELS) {
      const rule = thresholds[level];
      const conditions = {
        "正确率": accuracy >= rule.accuracy, "不同题目数": records.length >= rule.distinct,
        "知识点覆盖率": coverage >= rule.coverage, "编程语言实践": languageOk,
        "综合实践": level === "精通" ? practice.size >= 2 : true,
      };
      if (Object.values(conditions).every(Boolean)) eligible = level;
      else {
        unmet = Object.entries(conditions).map(([condition, passed]) => ({ condition, passed }));
        break;
      }
    }
    const snapshots = db.levelSnapshots.filter((item) => item.module_id === moduleId);
    const display = snapshots.length
      ? snapshots.map((item) => item.level).sort((a, b) => LEVELS.indexOf(b) - LEVELS.indexOf(a))[0]
      : null;
    const nextLevel = eligible ? (eligible === "精通" ? null : LEVELS[LEVELS.indexOf(eligible) + 1]) : "入门";
    const rule = nextLevel ? thresholds[nextLevel] : null;
    return {
      module_id: moduleId, eligible_level: eligible, next_level: nextLevel,
      next_requirements: rule ? {
        level: nextLevel, accuracy: rule.accuracy, distinct: rule.distinct, coverage: rule.coverage,
        current_accuracy: accuracy, current_distinct: records.length, current_coverage: coverage,
        needed_accuracy_hits: Math.max(0, rule.distinct - records.length),
        needed_knowledge_points: Math.max(0, Math.ceil(rule.coverage * totalKps.size) - passedKps.size),
      } : null,
      accuracy, coverage, distinct_questions: records.length, correct_questions: correct.length,
      total_questions: logical.size, total_knowledge_points: totalKps.size,
      covered_knowledge_points: passedKps.size, unmet_conditions: unmet,
      practice_passed: practice.size, language_ok: languageOk, display_level: display,
    };
  }

  function moduleResults() {
    return seed.modules.map((module) => {
      const mastery = evalMastery(module.id);
      const qs = allQuestions().filter((q) => q.module_id === module.id);
      return {
        ...module, ...mastery, title: module.title, short_title: module.short_title,
        color: module.color, position: module.position, target_level: module.target_level,
        priority: module.priority, question_count: qs.length,
        knowledge_point_count: seed.knowledge_points.filter((point) => point.module_id === module.id).length,
      };
    });
  }

  function stats() {
    const graded = db.attempts.filter((attempt) => attempt.is_correct !== null);
    const correct = graded.filter((attempt) => attempt.is_correct).length;
    const days = [...new Set(db.attempts.map((attempt) => attempt.created_at.slice(0, 10)))].sort().reverse();
    let streak = 0;
    let cursor = new Date(`${today()}T12:00:00+08:00`);
    while (days.includes(localDate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    const series = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(`${today()}T12:00:00+08:00`);
      date.setDate(date.getDate() - offset);
      const day = localDate(date);
      const attempts = db.attempts.filter((attempt) => attempt.created_at.slice(0, 10) === day);
      const scored = attempts.filter((attempt) => attempt.is_correct !== null);
      series.push({
        date: day, attempts: attempts.length,
        correct: scored.filter((attempt) => attempt.is_correct).length,
        accuracy: scored.length ? scored.filter((attempt) => attempt.is_correct).length / scored.length : null,
      });
    }
    const kpRows = new Map();
    for (const attempt of graded.filter((attempt) => !attempt.viewed_solution)) {
      const q = questionById(attempt.question_id);
      if (!q) continue;
      const row = kpRows.get(q.kp_id) || { id: q.kp_id, title: pointById(q.kp_id)?.title || q.kp_id, module_id: q.module_id, short_title: moduleById(q.module_id)?.short_title || q.module_id, attempts: 0, correct: 0 };
      row.attempts += 1;
      if (attempt.is_correct) row.correct += 1;
      kpRows.set(q.kp_id, row);
    }
    const weak = [...kpRows.values()].map((item) => ({ ...item, accuracy: item.correct / item.attempts })).sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
    const language = {};
    for (const languageId of ["python", "cpp"]) {
      const latest = new Map();
      for (const attempt of db.attempts.filter((a) => a.language === languageId && !a.viewed_solution)) {
        const q = questionById(attempt.question_id);
        if (q?.type === "acm") latest.set(q.logical_id, attempt);
      }
      const accepted = [...latest.values()].filter((attempt) => attempt.is_correct).length;
      language[languageId] = {
        submitted_questions: latest.size, accepted_questions: accepted,
        independent_acceptance_rate: latest.size ? accepted / latest.size : 0, total: 0, accepted: 0,
      };
    }
    const taskTotal = db.dailyTasks.length;
    const taskDone = db.dailyTasks.filter((task) => task.completed).length;
    const reviewAttempts = graded.filter((attempt) => attempt.mode === "review");
    const nonReview = graded.filter((attempt) => attempt.mode !== "review");
    return {
      total_attempts: db.attempts.length, graded_attempts: graded.length, correct_attempts: correct,
      accuracy: graded.length ? correct / graded.length : null, active_days: days.length, streak,
      last_14_days: series, weak_knowledge_points: weak, language,
      plan_completion: taskTotal ? taskDone / taskTotal : 0, task_total: taskTotal, task_completed: taskDone,
      review_effect: {
        attempts: reviewAttempts.length, correct: reviewAttempts.filter((a) => a.is_correct).length,
        accuracy: reviewAttempts.length ? reviewAttempts.filter((a) => a.is_correct).length / reviewAttempts.length : null,
        before_accuracy: nonReview.length ? nonReview.filter((a) => a.is_correct).length / nonReview.length : null,
      },
      level_changes: [...db.levelSnapshots].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)
        .map((item) => ({ ...item, short_title: moduleById(item.module_id)?.short_title || item.module_id })),
      accepted_logical_problems: new Set(db.attempts.filter((a) => a.is_correct && a.language).map((a) => questionById(a.question_id)?.logical_id)).size,
      total_accepted: db.attempts.filter((a) => a.is_correct && a.language).length,
      total_submissions: db.submissions.length,
      accepted_submissions: db.submissions.filter((s) => s.status === "ACCEPTED").length,
    };
  }

  function readiness() {
    const mastery = Object.fromEntries(moduleResults().map((item) => [item.module_id, item]));
    const statistics = stats();
    const evidenced = db.milestones.filter((item) => item.status === "done" && item.evidence).length;
    const completedInterviews = db.interviews.filter((item) => item.status === "completed");
    const avgInterview = completedInterviews.length
      ? completedInterviews.reduce((sum, item) => sum + Number(item.score || 0), 0) / completedInterviews.length : 0;
    const levelAtLeast = (id, level) => {
      const value = mastery[id]?.display_level || mastery[id]?.eligible_level;
      return Boolean(value && LEVELS.indexOf(value) >= LEVELS.indexOf(level));
    };
    const criteria = [
      { id: "python", title: "Python 编程基础", weight: 15, passed: levelAtLeast("python", "掌握"), evidence: `当前模块等级：${mastery.python?.display_level || "未入门"}；目标至少掌握。` },
      { id: "automation", title: "Python 自动化脚本", weight: 20, passed: levelAtLeast("automation", "掌握") && statistics.language.python.accepted_questions >= 1, evidence: "自动化模块需达到掌握，并至少一道 Python ACM/脚本题独立通过。" },
      { id: "cpp", title: "C++ 基础与核心数据结构", weight: 15, passed: levelAtLeast("cpp", "掌握"), evidence: `当前模块等级：${mastery.cpp?.display_level || "未入门"}；目标至少掌握。` },
      { id: "acm", title: "基础 ACM 独立完成", weight: 15, passed: statistics.accepted_logical_problems >= 3 && statistics.language.python.accepted_questions >= 1 && statistics.language.cpp.accepted_questions >= 1, evidence: `已独立 Accepted 逻辑题 ${statistics.accepted_logical_problems}/3，且需 Python 与 C++ 各有一次 Accepted。` },
      { id: "testing", title: "测试理论与用例设计", weight: 15, passed: levelAtLeast("testing", "掌握"), evidence: `当前模块等级：${mastery.testing?.display_level || "未入门"}；目标至少掌握。` },
      { id: "project", title: "可演示实战项目", weight: 15, passed: evidenced >= 5, evidence: `已有证据的完成里程碑：${evidenced}/6；至少需要 5 个。` },
      { id: "interview", title: "模拟面试与项目表达", weight: 5, passed: completedInterviews.length >= 2 && avgInterview >= 60, evidence: `已完成模拟面试 ${completedInterviews.length} 次，平均分 ${avgInterview.toFixed(1)}；至少 2 次且平均 ≥60。` },
    ];
    const score = criteria.filter((item) => item.passed).reduce((sum, item) => sum + item.weight, 0);
    return {
      score, max_score: 100,
      label: score === 0 ? "尚未开始" : score < 60 ? "基础构建中" : score < 100 ? "接近面试准备" : "核心门槛均已形成证据",
      criteria,
      disclaimer: "这是基于云端真实学习记录形成的准备度检查，不是录用概率或能力认证。",
      stats: { total_attempts: statistics.total_attempts, streak: statistics.streak, accepted_logical_problems: statistics.accepted_logical_problems },
    };
  }

  function recordLevels() {
    for (const module of seed.modules) {
      const result = evalMastery(module.id);
      const previous = db.levelSnapshots.filter((item) => item.module_id === module.id)
        .map((item) => item.level).sort((a, b) => LEVELS.indexOf(b) - LEVELS.indexOf(a))[0];
      if (result.eligible_level && (!previous || LEVELS.indexOf(result.eligible_level) > LEVELS.indexOf(previous))) {
        db.levelSnapshots.push({
          id: nextId++, module_id: module.id, level: result.eligible_level,
          metrics_json: JSON.stringify({ accuracy: result.accuracy, distinct: result.distinct_questions, coverage: result.coverage }),
          reasons_json: JSON.stringify(result.unmet_conditions), created_at: now(),
        });
      }
    }
  }

  function enqueueWrong(questionId, attemptId, errorCategory) {
    const intervals = db.settings.review_intervals || [1, 3, 7, 14, 30];
    const due = nextDue(intervals[0]);
    let review = db.reviews.find((item) => item.question_id === questionId);
    if (review) {
      Object.assign(review, {
        original_attempt_id: attemptId, wrong_count: review.wrong_count + 1,
        correct_streak: 0, stage_index: 0, due_date: due, status: "active",
        error_category: errorCategory, updated_at: now(),
      });
    } else {
      review = {
        id: nextId++, question_id: questionId, original_attempt_id: attemptId,
        wrong_count: 1, correct_streak: 0, stage_index: 0, due_date: due,
        last_reviewed_at: null, status: "active", error_category: errorCategory,
        variant_question_id: null, created_at: now(), updated_at: now(),
      };
      db.reviews.push(review);
    }
    return review;
  }

  function advanceReview(questionId, correct) {
    const review = db.reviews.find((item) => item.question_id === questionId);
    if (!review) return null;
    const intervals = db.settings.review_intervals || [1, 3, 7, 14, 30];
    if (!correct) {
      enqueueWrong(questionId, review.original_attempt_id, review.error_category);
      return review;
    }
    review.correct_streak += 1;
    review.stage_index += 1;
    review.last_reviewed_at = now();
    if (review.stage_index >= intervals.length) {
      review.status = "completed";
      review.due_date = today();
    } else {
      review.due_date = nextDue(intervals[review.stage_index]);
    }
    review.updated_at = now();
    return review;
  }

  function markTask(questionId, taskId) {
    const task = db.dailyTasks.find((item) => (taskId && item.id === Number(taskId)) || (!taskId && item.task_date === today() && item.question_id === questionId));
    if (task && !task.completed) {
      task.completed = true;
      task.completed_at = now();
    }
  }

  function reviewList() {
    const items = db.reviews.map((review) => {
      const q = questionById(review.question_id);
      const kp = pointById(q?.kp_id);
      const module = moduleById(q?.module_id);
      return {
        ...review, title: q?.title || "题目已移除", type: q?.type || "",
        difficulty: q?.difficulty || "", module_id: q?.module_id || "", kp_id: q?.kp_id || "",
        kp_title: kp?.title || "", module_title: module?.short_title || "",
        color: module?.color || "", variant_title: review.variant_question_id ? questionById(review.variant_question_id)?.title || "" : "",
      };
    }).sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.due_date.localeCompare(b.due_date));
    const variants = db.attempts.filter((attempt) => db.reviews.some((review) => review.variant_question_id === attempt.question_id) && !attempt.viewed_solution);
    const reviewAttempts = db.attempts.filter((attempt) => ["review", "programming-review"].includes(attempt.mode) && !attempt.viewed_solution);
    return {
      items, wrong_count: items.length,
      due_count: items.filter((item) => item.status === "active" && item.due_date <= today()).length,
      active_count: items.filter((item) => item.status === "active").length,
      weak_points: [...new Set(items.filter((item) => item.kp_id).map((item) => item.kp_id))].map((kpId) => ({
        kp_id: kpId, title: pointById(kpId)?.title || kpId,
        module: moduleById(pointById(kpId)?.module_id)?.short_title || "",
        count: items.filter((item) => item.kp_id === kpId).length,
      })).sort((a, b) => b.count - a.count),
      variant_effect: {
        attempts: variants.length, correct: variants.filter((a) => a.is_correct).length,
        accuracy: variants.length ? variants.filter((a) => a.is_correct).length / variants.length : null,
      },
      review_effect: {
        attempts: reviewAttempts.length, correct: reviewAttempts.filter((a) => a.is_correct).length,
        accuracy: reviewAttempts.length ? reviewAttempts.filter((a) => a.is_correct).length / reviewAttempts.length : null,
      },
    };
  }

  function publicModule(module) {
    const result = moduleResults().find((item) => item.module_id === module.id);
    return {
      ...module, ...result, title: module.title, short_title: module.short_title,
      color: module.color, position: module.position, target_level: module.target_level,
      priority: module.priority,
      question_count: allQuestions().filter((q) => q.module_id === module.id).length,
      knowledge_point_count: seed.knowledge_points.filter((point) => point.module_id === module.id).length,
    };
  }

  function getKnowledge(id) {
    const point = pointById(id);
    if (!point) return null;
    const module = moduleById(point.module_id);
    return {
      ...point, module_title: module.title, module_color: module.color,
      questions: allQuestions().filter((q) => q.kp_id === id).map((q) => ({ id: q.id, title: q.title, type: q.type, difficulty: q.difficulty })),
      notes: db.notes.filter((note) => note.kp_id === id).map(({ id: noteId, title, updated_at }) => ({ id: noteId, title, updated_at })),
      sources: point.sources || seed.source_map[id] || [],
    };
  }

  function generationCapabilities() {
    return {
      engine: "local", label: "本地模板引擎", requires_api_key: false, requires_network: false,
      notice: "在线版题目由本地课程资料和确定性规则生成，结果同步到私人云端空间。",
      modules: seed.modules.map((module) => ({
        module_id: module.id, module_title: module.title,
        knowledge_points: seed.knowledge_points.filter((point) => point.module_id === module.id).map((point) => ({
          kp_id: point.id, title: point.title, difficulties: ["入门", "基础", "进阶"],
          types: module.id === "project" ? ["fill_blank", "interview", "multiple_choice", "single_choice", "test_plan", "true_false"]
            : ["testing", "unity"].includes(module.id) ? ["fill_blank", "interview", "multiple_choice", "single_choice", "test_case_design", "true_false"]
              : ["fill_blank", "interview", "multiple_choice", "scenario", "single_choice", "true_false"],
          blueprint_count: contexts.length * archetypes.length,
          acm_available: false,
          sources: point.sources || seed.source_map[point.id] || [],
        })),
      })),
    };
  }

  function localGenerate(moduleId, kpId, difficulty, count, parentId = null) {
    const module = moduleById(moduleId);
    const point = pointById(kpId);
    if (!module || !point) throw Object.assign(new Error("模块或知识点不存在。"), { status: 400 });
    const sources = point.sources || seed.source_map[kpId] || [];
    const content = point.content || {};
    const parent = parentId ? questionById(parentId) : null;
    if (parent && (parent.module_id !== moduleId || parent.kp_id !== kpId)) throw Object.assign(new Error("变式题必须沿用原题的知识点。"), { status: 400 });
    const wanted = Math.max(1, Math.min(10, Number(count || 3)));
    const accepted = [];
    let duplicates = 0;
    for (let contextIndex = 0; contextIndex < contexts.length && accepted.length < wanted; contextIndex += 1) {
      const [contextName, scene] = contexts[contextIndex];
      for (const archetype of archetypes) {
        if (accepted.length >= wanted) break;
        const lead = parentId ? "变式 · 关联变式 · " : `${contextName} · `;
        const title = `${lead}${archetype}：${point.title}`;
        const principle = content.principle || point.summary;
        const why = content.why || point.summary;
        const errors = content.errors || "忽略边界与失败路径。";
        const testUse = content.test_use || "用可观察结果验证实际行为。";
        const relation = content.relation || "与相邻知识点共同构成完整测试能力。";
        const interview = content.interview || `请解释 ${point.title}。`;
        let raw;
        if (archetype === "概念定位") {
          raw = {
            title, type: "single_choice", difficulty,
            stem: `场景：${parentId ? "把原题迁移到一个新的业务情境中。" : scene}\n\n关于「${point.title}」，下面哪项描述最准确？`,
            options: [
              { key: "A", text: principle }, { key: "B", text: errors },
              { key: "C", text: "只需要记住术语，不需要验证实际行为。" },
              { key: "D", text: "该知识点只适用于背诵，不能用于测试工作。" },
            ], answer: ["A"], explanation_short: principle,
            explanation: `${principle}\n\n在测试工作中：${testUse}`,
            target: `理解并应用「${point.title}」。`, common_mistakes: errors,
            application: testUse, data: { option_notes: { B: errors }, local_archetype: archetype, sources },
          };
        } else if (archetype === "错误识别") {
          raw = {
            title, type: "true_false", difficulty,
            stem: `场景：${parentId ? "复盘原题涉及的错误做法。" : scene}\n\n判断下面说法是否正确：\n\n> ${errors}`,
            answer: ["错误"], explanation_short: `正确原则是：${principle}`,
            explanation: `${errors}\n\n正确理解应为：${principle}`,
            target: `识别「${point.title}」的常见错误。`, common_mistakes: errors,
            application: testUse, data: { local_archetype: archetype, sources },
          };
        } else if (archetype === "实践选择") {
          if (["testing", "unity", "project"].includes(moduleId)) {
            const rubric = [`说明目标：${why}`, `采用正确做法：${testUse}`, `避免错误：${errors}`, "给出可观察结果、边界和证据"];
            raw = {
              title, type: moduleId === "project" ? "test_plan" : "test_case_design", difficulty,
              stem: `场景：${parentId ? "针对一个与原题不同的活动版本设计验证方案。" : scene}\n\n围绕「${point.title}」写清前置条件、步骤、预期结果和至少一个异常边界。`,
              answer: rubric, explanation_short: `用可观察结果验证：${testUse}`,
              explanation: `${why}\n\n${testUse}\n\n避免：${errors}`,
              target: `设计「${point.title}」的实践验证。`, common_mistakes: errors,
              application: testUse, data: { manual: true, rubric, local_archetype: archetype, sources },
            };
          } else {
            raw = {
              title, type: "single_choice", difficulty,
              stem: `场景：${parentId ? "在新的项目情境中迁移原题知识。" : scene}\n\n面对与「${point.title}」相关的工作，哪种做法最合理？`,
              options: [
                { key: "A", text: testUse }, { key: "B", text: errors },
                { key: "C", text: "只检查界面是否显示，不核对数据和副作用。" },
                { key: "D", text: "失败后无限重试，直到偶然通过。" },
              ], answer: ["A"], explanation_short: testUse,
              explanation: `${testUse}\n\n原因：${why}`,
              target: `把「${point.title}」用于测试工作。`, common_mistakes: errors,
              application: testUse, data: { option_notes: { B: errors }, local_archetype: archetype, sources },
            };
          }
        } else if (archetype === "关系辨析") {
          raw = {
            title, type: "multiple_choice", difficulty,
            stem: `场景：${scene}\n\n关于「${point.title}」与测试开发工作的关系，哪些说法正确？`,
            options: [
              { key: "A", text: why }, { key: "B", text: testUse },
              { key: "C", text: errors }, { key: "D", text: "与任何其他知识点都没有关系。" },
            ], answer: ["A", "B"], explanation_short: `${why}；${testUse}`,
            explanation: `${why}\n\n测试应用：${testUse}\n\n关系：${relation}`,
            target: `理解「${point.title}」的工作价值。`, common_mistakes: errors,
            application: testUse, data: { option_notes: { C: errors }, local_archetype: archetype, sources },
          };
        } else if (archetype === "术语补全") {
          raw = {
            title, type: "fill_blank", difficulty,
            stem: `场景：${scene}\n\n请补全本知识点的核心主题名称：\n\n当前内容的主题是「____」。`,
            answer: [point.title], explanation_short: `主题是「${point.title}」。`,
            explanation: principle, target: "建立知识点索引。", common_mistakes: errors,
            application: testUse, data: { local_archetype: archetype, sources },
          };
        } else {
          const rubric = [`说明原理：${principle}`, `结合实际：${testUse}`, `指出错误：${errors}`, `联系其他能力：${relation}`];
          raw = {
            title, type: "interview", difficulty,
            stem: `场景：${scene}\n\n面试问题：${interview}\n\n请用“结论—原理—例子—边界”回答。`,
            answer: rubric, explanation_short: `先说明「${point.title}」的作用，再给测试案例。`,
            explanation: `1. ${principle}\n2. ${testUse}\n3. 避免 ${errors}\n4. ${relation}`,
            target: `清楚表达「${point.title}」。`, common_mistakes: errors,
            application: testUse, data: { manual: true, rubric, local_archetype: archetype, sources },
          };
        }
        const fingerprint = hash(`${raw.title}${raw.stem}`);
        if (allQuestions().some((question) => hash(`${question.title}${question.stem}`) === fingerprint)) {
          duplicates += 1;
          continue;
        }
        const id = `web-${uuid()}`;
        const question = {
          id, logical_id: `web-${fingerprint}`, module_id: moduleId, kp_id: kpId,
          title: raw.title, type: raw.type, difficulty, stem: raw.stem, data: raw.data || {},
          answer: raw.answer, explanation_short: raw.explanation_short,
          explanation: raw.explanation, target: raw.target, common_mistakes: raw.common_mistakes,
          application: raw.application, reference_url: sources[0]?.url || "",
          source_type: "本地模板生成", fingerprint: `web-${fingerprint}`,
          validation_status: "浏览器本地规则校验", version: 1, parent_id: parentId,
          comprehensive: false, created_at: now(), updated_at: now(), tests: [],
        };
        if (raw.options) question.data.options = raw.options;
        db.customQuestions.push(question);
        accepted.push({
          id, title, type: question.type, difficulty, module_id: moduleId,
          kp_id: kpId, validation_status: question.validation_status, engine: "local",
        });
      }
    }
    db.generations.push({
      id: nextId++, engine: "local", module_id: moduleId, kp_id: kpId,
      requested: wanted, accepted: accepted.length, duplicate: duplicates, created_at: now(),
    });
    save();
    return {
      engine: "local", engine_label: "本地模板引擎", accepted,
      accepted_count: accepted.length, failed_count: 0, duplicate_count: duplicates,
      sources, rejected: [], network_verified: false, requires_network: false,
      notice: "题目由课程资料与确定性规则生成，不是大模型输出；官方资料为内置索引，未实时联网。",
    };
  }

  function noteResponse(note) {
    const module = moduleById(note.module_id);
    const point = pointById(note.kp_id);
    return { ...note, module_title: module?.short_title || "", kp_title: point?.title || "" };
  }

  function exportPayload() {
    return {
      format: "testdev-learning-lab", version: 1, exported_at: now(),
      notice: "云端学习版备份；不含任何访问密钥或模型密钥。",
      data: {
        tables: {
          attempts: clone(db.attempts), reviews: clone(db.reviews),
          daily_tasks: clone(db.dailyTasks), notes: clone(db.notes),
          drafts: Object.entries(db.drafts).flatMap(([questionId, languages]) =>
            Object.entries(languages).map(([language, value]) => ({ question_id: questionId, language, code: value.code, updated_at: value.updated_at }))),
          submissions: clone(db.submissions), level_snapshots: clone(db.levelSnapshots),
          projects: db.project ? [clone(db.project)] : [], project_milestones: clone(db.milestones),
          interviews: clone(db.interviews), ai_generations: clone(db.generations),
          questions: clone(db.customQuestions),
          question_tests: db.customQuestions.flatMap((q) => (q.tests || []).map((test, index) => ({ question_id: q.id, position: index + 1, input: test.input, expected: test.expected, is_hidden: test.hidden ? 1 : 0, description: test.description || "" }))),
          settings: Object.entries(db.settings).map(([key, value]) => ({ key, value_json: JSON.stringify(value) })),
        },
      },
    };
  }

  function importPayload(backup, mode, confirm) {
    if (!backup || backup.format !== "testdev-learning-lab" || backup.version !== 1 || !backup.data?.tables) {
      return { ok: false, imported: 0, errors: ["备份格式或版本不合法。"] };
    }
    if (mode === "replace" && !confirm) return { ok: false, imported: 0, errors: ["覆盖导入需要明确确认。"] };
    const tables = backup.data.tables;
    const nowValue = now();
    if (mode === "replace") {
      for (const key of ["attempts", "reviews", "dailyTasks", "notes", "interviews", "customQuestions", "levelSnapshots", "generations"]) db[key] = [];
      db.drafts = {};
    }
    const merge = (key, rows) => {
      const target = db[key];
      for (const row of rows || []) {
        if (!target.some((item) => String(item.id) === String(row.id))) target.push(clone(row));
      }
    };
    merge("attempts", tables.attempts); merge("reviews", tables.reviews);
    merge("dailyTasks", tables.daily_tasks); merge("notes", tables.notes);
    merge("submissions", tables.submissions); merge("levelSnapshots", tables.level_snapshots);
    merge("interviews", tables.interviews); merge("customQuestions", tables.questions);
    merge("generations", tables.ai_generations);
    for (const draft of tables.drafts || []) {
      db.drafts[draft.question_id] ||= {};
      db.drafts[draft.question_id][draft.language] ||= { code: draft.code, updated_at: draft.updated_at };
    }
    if (Array.isArray(tables.project_milestones)) db.milestones = clone(tables.project_milestones);
    for (const setting of tables.settings || []) {
      try { db.settings[setting.key] = JSON.parse(setting.value_json); } catch {}
    }
    db.settings.question_generation_engine = "local";
    db.settings.ai_api_key = "";
    db.settings.tavily_api_key = "";
    save();
    return {
      ok: true, mode, imported: Object.values(tables).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0),
      errors: [], notice: `导入完成于 ${nowValue}。`,
    };
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  function fail(message, status = 400) {
    return json({ ok: false, error: message, status }, status);
  }

  const WANDBOX_URL = "https://wandbox.org/api/compile.json";
  const WANDBOX_LANGUAGES = {
    python: { compiler: "cpython-3.13.8", label: "Python 3.13" },
    cpp: { compiler: "gcc-13.2.0", label: "C++17" },
  };

  async function runBrowserWandbox(language, code, stdin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const started = Date.now();
    try {
      const response = await nativeFetch(WANDBOX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compiler: language.compiler,
          code,
          stdin,
          options: language.compiler.startsWith("gcc") ? "warning,c++17" : "",
          "compiler-option-raw": language.compiler.startsWith("gcc") ? "-O2" : "",
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error(`编译器返回了非 JSON 响应（HTTP ${response.status}）。`); }
      if (!response.ok) throw new Error(data?.message || `编译器服务请求失败（HTTP ${response.status}）。`);
      return { data, runtimeMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  async function browserJudge(body) {
    const question = questionById(body.question_id);
    const selectedLanguage = WANDBOX_LANGUAGES[body.language];
    const code = String(body.code || "");
    if (!question || question.type !== "acm") return { ok: false, error: "编程题不存在。" };
    if (!selectedLanguage) return { ok: false, error: "只支持 Python 与 C++17。" };
    if (!code.trim()) return { ok: false, error: "请先编写代码。" };
    if (new TextEncoder().encode(code).length > 200000) return { ok: false, error: "代码超过 200 KB 限制。" };

    let tests = clone(question.tests || []);
    if (body.run_mode === "sample") tests = tests.filter((test) => !test.hidden);
    if (body.run_mode === "custom") {
      tests = [{ input: String(body.custom_input || ""), expected: null, hidden: false, description: "自定义输入" }];
    }
    if (!tests.length) return { ok: false, error: "题目没有可用测试数据。" };
    if (tests.length > 6) return { ok: false, error: "单次提交最多支持 6 组测试。" };

    const results = [];
    let compileOutput = "";
    let totalRuntime = 0;
    for (let index = 0; index < tests.length; index += 1) {
      const test = tests[index];
      let run;
      try {
        run = await runBrowserWandbox(selectedLanguage, code, test.input);
      } catch (error) {
        return {
          ok: false,
          status: "SYSTEM_ERROR",
          error: `在线判题服务不可用：${error.message}`,
          passed: results.filter((item) => item.status === "ACCEPTED").length,
          total: tests.length,
          results,
          compile_output: compileOutput,
          runtime_ms: totalRuntime,
          mode: "wandbox-browser",
        };
      }
      const data = run.data;
      totalRuntime += run.runtimeMs;
      const compilerError = String(data.compiler_error || "").trim();
      const compilerMessage = String(data.compiler_message || "").trim();
      if (compilerError || compilerMessage) {
        compileOutput = compilerError || compilerMessage;
        results.push({
          index: index + 1,
          status: "COMPILATION_ERROR",
          runtime_ms: run.runtimeMs,
          description: test.description || "",
        });
        break;
      }
      const programError = String(data.program_error || "").trim();
      const statusCode = String(data.status ?? "");
      const actual = String(data.program_output || "");
      let status;
      if (statusCode !== "0" || programError) status = "RUNTIME_ERROR";
      else if (test.expected === null) status = "CUSTOM_RUN";
      else if (
        String(actual).replace(/\r\n/g, "\n").trimEnd().split("\n").map((line) => line.trimEnd()).join("\n").trim()
        === String(test.expected).replace(/\r\n/g, "\n").trimEnd().split("\n").map((line) => line.trimEnd()).join("\n").trim()
      ) status = "ACCEPTED";
      else status = "WRONG_ANSWER";
      const result = {
        index: index + 1,
        status,
        runtime_ms: run.runtimeMs,
        description: test.description || "",
      };
      if (!test.hidden) {
        result.input = test.input;
        result.expected = test.expected;
        result.actual = actual;
        result.stderr = programError;
      }
      results.push(result);
    }

    let status;
    if (results.some((item) => item.status === "COMPILATION_ERROR")) status = "COMPILATION_ERROR";
    else if (results.some((item) => item.status === "RUNTIME_ERROR")) status = "RUNTIME_ERROR";
    else if (body.run_mode === "custom" && results.every((item) => item.status === "CUSTOM_RUN")) status = "CUSTOM_RUN";
    else if (results.length === tests.length && results.every((item) => item.status === "ACCEPTED")) status = "ACCEPTED";
    else status = "WRONG_ANSWER";
    return {
      ok: true,
      status,
      passed: results.filter((item) => item.status === "ACCEPTED").length,
      total: tests.length,
      results,
      compile_output: compileOutput,
      runtime_ms: totalRuntime,
      memory_kb: 0,
      message: status === "ACCEPTED"
        ? "全部测试通过。"
        : status === "CUSTOM_RUN"
          ? "自定义输入已执行，没有与标准答案比较。"
          : "未通过全部必需测试。",
      mode: "wandbox-browser",
      engine: selectedLanguage.label,
    };
  }

  async function onlineJudge(body) {
    const question = questionById(body.question_id);
    if (!question || question.type !== "acm") {
      return fail("ACM 题目不存在。", 404);
    }
    let result;
    if (useCloud) {
      let response;
      try {
        response = await cloudRequest(ONLINE_JUDGE_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            question_id: body.question_id,
            language: body.language,
            code: body.code,
            run_mode: body.run_mode || "submit",
            custom_input: body.custom_input || "",
          }),
        });
      } catch (error) {
        setCloudStatus("判题服务连接失败", true);
        return fail(`在线判题服务连接失败：${error.message}`, 503);
      }
      result = await response.json();
      if (!response.ok) {
        return fail(result.error || result.message || "在线判题服务暂时不可用。", response.status);
      }
    } else {
      result = await browserJudge(body);
      if (!result.ok) return fail(result.error || result.message || "在线判题服务暂时不可用。", 503);
    }
    if (!["submit"].includes(body.run_mode)) return { ok: true, persisted: false, ...result };

    const accepted = result.status === "ACCEPTED";
    const submission = {
      id: nextId++,
      question_id: question.id,
      language: body.language,
      code: String(body.code || ""),
      status: result.status,
      passed_count: result.passed || 0,
      total_count: result.total || 0,
      test_results_json: JSON.stringify(result.results || []),
      compile_output: result.compile_output || "",
      runtime_ms: result.runtime_ms || 0,
      memory_kb: result.memory_kb || 0,
      is_correct: accepted ? 1 : 0,
      viewed_solution: body.viewed_solution ? 1 : 0,
      created_at: now(),
    };
    db.submissions.push(submission);
    const attempt = {
      id: nextId++,
      question_id: question.id,
      task_id: body.task_id ? Number(body.task_id) : null,
      answer_json: JSON.stringify({
        status: result.status,
        passed: result.passed,
        total: result.total,
      }),
      language: body.language,
      is_correct: accepted,
      score: result.total ? (100 * result.passed) / result.total : 0,
      mode: body.task_kind === "review" ? "programming-review" : "programming",
      viewed_solution: body.viewed_solution ? 1 : 0,
      elapsed_seconds: Number(body.elapsed_seconds || 0),
      error_category: accepted ? "" : `代码评测：${result.status}`,
      self_review: "",
      created_at: now(),
    };
    db.attempts.push(attempt);
    if (accepted) {
      markTask(question.id, body.task_id);
      if (!attempt.viewed_solution) advanceReview(question.id, true);
    } else {
      enqueueWrong(question.id, attempt.id, attempt.error_category);
    }
    recordLevels();
    save();
    setCloudStatus("判题结果已同步");
    return {
      ok: true,
      persisted: true,
      submission_id: submission.id,
      attempt_id: attempt.id,
      ...result,
    };
  }

  async function handle(path, method, query, body) {
    if (path === "/api/health") {
      return {
        ok: true, app: "测开转岗训练营", version: "online-1.0",
        counts: { modules: seed.modules.length, knowledge_points: seed.knowledge_points.length, questions: allQuestions().length, attempts: db.attempts.length, notes: db.notes.length, submissions: db.submissions.length },
        judge: { mode: useCloud ? "wandbox" : "wandbox-browser", available: true, label: "Wandbox 在线评测", warning: "代码会发送到 Wandbox 免费编译服务，仅用于个人练习；服务异常时不会伪造结果。" },
        ai: { configured: false, provider: "online-local-only" },
        generation: { engine: "local", local_available: true, local_label: "本地模板引擎" },
        source_catalog: seed.catalog, today: today(),
      };
    }
    if (path === "/api/dashboard") {
      const phase = currentPhase();
      const tasks = buildTaskPlan();
      const results = moduleResults();
      const statistics = stats();
      const currentProject = db.project ? { ...db.project, done_count: db.milestones.filter((m) => m.status === "done").length, total_count: db.milestones.length } : null;
      const milestone = [...db.milestones].sort((a, b) => (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) || a.due_date.localeCompare(b.due_date))[0] || null;
      return {
        today_tasks: tasks, phase, streak: statistics.streak, week: statistics.last_14_days.slice(-7),
        modules: results, weak_points: statistics.weak_knowledge_points.slice(0, 3),
        due_reviews: db.reviews.filter((review) => review.status === "active" && review.due_date <= today()).length,
        project: currentProject, recent_milestone: milestone, language: statistics.language,
        total_attempts: statistics.total_attempts, total_accepted: statistics.total_accepted,
        readiness: readiness(), today: today(),
        days_to_target: Math.max(0, Math.ceil((new Date("2027-03-01T00:00:00+08:00") - new Date()) / 86400000)),
      };
    }
    if (path === "/api/settings") {
      return {
        ...db.settings, ai_api_key_configured: false, tavily_api_key_configured: false,
        environment: {
          online: useCloud,
          storage_mode: useCloud ? "cloud" : "browser",
          judge: { mode: useCloud ? "wandbox" : "wandbox-browser", available: true, label: "Wandbox 在线评测", warning: "代码会发送到 Wandbox 免费编译服务；服务异常时不会伪造结果。" },
          ai_base_url_from_env: "", ai_model_from_env: "",
        },
      };
    }
    if (path === "/api/generation/capabilities") return generationCapabilities();
    if (path === "/api/tasks") return buildTaskPlan(query.get("date") || today());
    if (path === "/api/modules") return { modules: moduleResults() };
    if (path.startsWith("/api/modules/")) {
      const module = moduleById(path.split("/").pop());
      if (!module) throw Object.assign(new Error("模块不存在。"), { status: 404 });
      const mastery = evalMastery(module.id);
      const points = seed.knowledge_points.filter((point) => point.module_id === module.id).map((point) => {
        const qs = allQuestions().filter((q) => q.kp_id === point.id);
        const passed = qs.filter((q) => db.attempts.some((attempt) => attempt.question_id === q.id && attempt.is_correct)).length;
        return { id: point.id, title: point.title, summary: point.summary, position: point.position, question_count: qs.length, passed_count: passed, state: passed >= Math.max(1, qs.length) ? "mastered" : passed ? "learning" : "not_started" };
      });
      return {
        module, mastery, knowledge_points: points,
        question_counts: allQuestions().filter((q) => q.module_id === module.id).reduce((result, q) => ((result[q.type] = (result[q.type] || 0) + 1), result), {}),
        level_history: db.levelSnapshots.filter((item) => item.module_id === module.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((item) => ({ ...item, metrics: JSON.parse(item.metrics_json || "{}") })),
      };
    }
    if (path.startsWith("/api/knowledge/")) {
      const result = getKnowledge(path.split("/").pop());
      if (!result) throw Object.assign(new Error("知识点不存在。"), { status: 404 });
      return result;
    }
    if (path.startsWith("/api/mindmap/")) {
      const moduleId = path.split("/").pop();
      const module = moduleById(moduleId);
      if (!module) throw Object.assign(new Error("模块不存在。"), { status: 404 });
      const nodes = seed.knowledge_points.filter((point) => point.module_id === moduleId).map((point) => {
        const qs = allQuestions().filter((q) => q.kp_id === point.id);
        const passed = qs.filter((q) => db.attempts.some((attempt) => attempt.question_id === q.id && attempt.is_correct)).length;
        return { ...point, state: passed >= Math.max(1, qs.length) ? "mastered" : passed ? "learning" : "not_started" };
      });
      return { module, nodes, edges: db.edges.filter((edge) => edge.module_id === moduleId) };
    }
    if (path === "/api/questions") {
      let questions = allQuestions();
      const fieldMap = { module_id: "module_id", kp_id: "kp_id", type: "type", difficulty: "difficulty" };
      for (const [key, field] of Object.entries(fieldMap)) if (query.get(key)) questions = questions.filter((q) => q[field] === query.get(key));
      if (query.get("q")) {
        const keyword = query.get("q").toLowerCase();
        questions = questions.filter((q) => `${q.title}${q.stem}`.toLowerCase().includes(keyword));
      }
      if (query.get("state") === "unattempted") questions = questions.filter((q) => !db.attempts.some((a) => a.question_id === q.id));
      if (query.get("state") === "wrong") questions = questions.filter((q) => db.reviews.some((r) => r.question_id === q.id && r.status === "active"));
      return {
        total: questions.length,
        questions: questions.map((q) => ({
          ...safeQuestion(q),
          kp_title: pointById(q.kp_id)?.title || q.kp_id,
          module_title: moduleById(q.module_id)?.short_title || q.module_id,
          module_color: moduleById(q.module_id)?.color || "#279f98",
        })),
      };
    }
    if (path.startsWith("/api/questions/")) {
      const id = path.split("/").pop();
      const question = questionById(id);
      if (!question) throw Object.assign(new Error("题目不存在。"), { status: 404 });
      return safeQuestion(question, query.get("reveal") === "1");
    }
    if (path === "/api/acm/problems") return handle("/api/questions", "GET", new URLSearchParams("type=acm"), {});
    if (path === "/api/reviews") return reviewList();
    if (path === "/api/stats") return stats();
    if (path === "/api/readiness") return readiness();
    if (path === "/api/sources") {
      const kpId = query.get("kp_id") || "";
      const point = pointById(kpId);
      return { catalog: seed.catalog, sources: point?.sources || seed.source_map[kpId] || [] };
    }
    if (path === "/api/notes") {
      const keyword = (query.get("q") || "").toLowerCase();
      return { notes: db.notes.filter((note) => !keyword || `${note.title}${note.body}`.toLowerCase().includes(keyword)).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updated_at.localeCompare(a.updated_at)).map(noteResponse) };
    }
    if (path === "/api/drafts") {
      const id = query.get("question_id") || "";
      const drafts = {};
      for (const [language, value] of Object.entries(db.drafts[id] || {})) drafts[language] = clone(value);
      return { drafts };
    }
    if (path === "/api/submissions") return { submissions: db.submissions.filter((item) => item.question_id === query.get("question_id")).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
    if (path === "/api/projects") return { project: db.project, milestones: db.milestones };
    if (path === "/api/interviews") return { interviews: db.interviews };
    if (path === "/api/plan") return { phases: seed.phases, current: currentPhase() };
    if (path === "/api/export") return exportPayload();
    if (method === "DELETE" && path === "/api/local-data") {
      if (!body.confirm) return fail("清空数据需要明确确认。");
      if (useCloud) {
        const response = await cloudRequest(CLOUD_STATE_ENDPOINT, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok) return fail(payload.error || "云端数据清除失败。", response.status);
      }
      localStorage.removeItem(STATE_KEY);
      return { ok: true, message: "云端和浏览器缓存已清空。" };
    }

    if (method === "POST" && path === "/api/tasks/rebuild") {
      return buildTaskPlan(body.date || today(), body.target, body.new_ratio, body.time_budget);
    }
    if (method === "POST" && path === "/api/attempts") {
      const question = questionById(body.question_id);
      if (!question) throw Object.assign(new Error("题目不存在。"), { status: 404 });
      if (question.type === "acm") throw Object.assign(new Error("在线版不执行 ACM 代码。"), { status: 400 });
      if (body.answer === undefined || body.answer === null || body.answer === "" || (Array.isArray(body.answer) && !body.answer.length)) {
        throw Object.assign(new Error("请先作答。"), { status: 400 });
      }
      const result = grade(question, body.answer);
      const attempt = {
        id: nextId++, question_id: question.id, task_id: body.task_id ? Number(body.task_id) : null,
        answer_json: JSON.stringify(body.answer), language: null,
        is_correct: result.is_correct, score: result.score, mode: body.mode || "new",
        viewed_solution: Boolean(body.viewed_solution), elapsed_seconds: Number(body.elapsed_seconds || 0),
        error_category: body.error_category || (result.is_correct === false ? "概念混淆" : ""),
        self_review: "", created_at: now(),
      };
      db.attempts.push(attempt);
      let review = null;
      if (result.is_correct === true) {
        markTask(question.id, body.task_id);
        if (!attempt.viewed_solution) review = advanceReview(question.id, true);
      } else if (result.is_correct === false) {
        review = enqueueWrong(question.id, attempt.id, attempt.error_category);
      }
      recordLevels();
      save();
      const data = question.data || {};
      return {
        attempt_id: attempt.id, created_at: attempt.created_at, ...result,
        question_id: question.id, correct_answer: question.answer,
        explanation_short: question.explanation_short, explanation: question.explanation,
        target: question.target, common_mistakes: question.common_mistakes,
        application: question.application, option_notes: data.option_notes || {},
        rubric: data.rubric || [], review: review ? { due_date: review.due_date, status: review.status, correct_streak: review.correct_streak } : null,
        next_action: result.is_correct === false ? "查看错因后安排到期复习。" : "完成一题同知识点变式或继续今日任务。",
      };
    }
    if (method === "POST" && /^\/api\/attempts\/\d+\/review$/.test(path)) {
      const id = Number(path.split("/")[3]);
      const attempt = db.attempts.find((item) => item.id === id);
      if (!attempt) throw Object.assign(new Error("答题记录不存在。"), { status: 404 });
      const score = Math.max(0, Math.min(100, Number(body.self_score)));
      if (!Number.isFinite(score)) throw Object.assign(new Error("自评分必须是 0 到 100。"), { status: 400 });
      attempt.score = score;
      attempt.is_correct = score >= 60;
      attempt.self_review = body.self_review || "";
      attempt.error_category = body.error_category || "";
      const question = questionById(attempt.question_id);
      if (attempt.is_correct) {
        markTask(attempt.question_id, attempt.task_id);
        if (!attempt.viewed_solution) advanceReview(attempt.question_id, true);
      } else {
        enqueueWrong(attempt.question_id, id, attempt.error_category || "开放题自评未达标");
      }
      recordLevels();
      save();
      return { ok: true, attempt_id: id, is_correct: attempt.is_correct, score, message: "开放题自评已保存，并纳入真实学习统计。" };
    }
    if (method === "POST" && path === "/api/settings") {
      const allowed = ["daily_question_target", "daily_time_budget_minutes", "new_question_ratio", "review_intervals", "mastery_thresholds", "question_generation_engine"];
      for (const [key, value] of Object.entries(body)) if (allowed.includes(key)) db.settings[key] = value;
      db.settings.question_generation_engine = "local";
      save();
      const tasks = buildTaskPlan(today());
      return { ok: true, settings: handle("/api/settings", "GET", new URLSearchParams(), {}), today_tasks: tasks };
    }
    if (method === "POST" && path === "/api/drafts") {
      if (!questionById(body.question_id)) throw Object.assign(new Error("题目不存在。"), { status: 404 });
      if (!["python", "cpp"].includes(body.language)) throw Object.assign(new Error("草稿语言不合法。"), { status: 400 });
      db.drafts[body.question_id] ||= {};
      db.drafts[body.question_id][body.language] = { code: String(body.code || ""), updated_at: now() };
      save();
      return { ok: true, saved_at: now() };
    }
    if (method === "POST" && path === "/api/judge") {
      return onlineJudge(body);
    }
    if (method === "POST" && path === "/api/notes") {
      if (!String(body.title || "").trim()) throw Object.assign(new Error("笔记标题不能为空。"), { status: 400 });
      const timestamp = now();
      const note = {
        id: body.id || `note-${uuid()}`, title: String(body.title).trim(), body: String(body.body || ""),
        module_id: body.module_id || null, kp_id: body.kp_id || null, question_id: body.question_id || null,
        favorite: body.favorite ? 1 : 0, created_at: timestamp, updated_at: timestamp,
      };
      db.notes.push(note); save();
      return { ok: true, note: noteResponse(note) };
    }
    if (method === "PUT" && path.startsWith("/api/notes/")) {
      const id = path.split("/").pop();
      const note = db.notes.find((item) => item.id === id);
      if (!note) throw Object.assign(new Error("笔记不存在。"), { status: 404 });
      Object.assign(note, { title: String(body.title || "未命名笔记"), body: String(body.body || ""), favorite: body.favorite ? 1 : 0, module_id: body.module_id || note.module_id || null, kp_id: body.kp_id || note.kp_id || null, question_id: body.question_id || note.question_id || null, updated_at: now() });
      save();
      return { ok: true, note: noteResponse(note) };
    }
    if (method === "DELETE" && path.startsWith("/api/notes/")) {
      if (!body.confirm) return fail("删除笔记需要明确确认。");
      db.notes = db.notes.filter((note) => note.id !== path.split("/").pop());
      save();
      return { ok: true };
    }
    if (method === "POST" && path === "/api/generate") {
      if ((body.engine || db.settings.question_generation_engine) === "remote") {
        return fail("在线学习版不保存远程模型密钥，也不会把密钥暴露给浏览器。请使用本地动态题库，或使用已配置服务端的本地部署。", 503);
      }
      return localGenerate(body.module_id, body.kp_id, body.difficulty || "基础", body.count || 3, body.parent_id || null);
    }
    if (method === "POST" && path.startsWith("/api/reviews/") && path.endsWith("/variant")) {
      const reviewId = Number(path.split("/")[3]);
      const review = db.reviews.find((item) => item.id === reviewId);
      if (!review) throw Object.assign(new Error("复习记录不存在。"), { status: 404 });
      const parent = questionById(review.question_id);
      const generated = localGenerate(parent.module_id, parent.kp_id, parent.difficulty, 1, parent.id);
      if (!generated.accepted.length) {
        const fallback = allQuestions().find((q) => q.kp_id === parent.kp_id && q.id !== parent.id);
        if (!fallback) throw Object.assign(new Error("没有可用变式题。"), { status: 404 });
        review.variant_question_id = fallback.id; save();
        return { ok: true, variant: { id: fallback.id, title: fallback.title, type: fallback.type, difficulty: fallback.difficulty }, reason: "本地变式已用完，改用同知识点已有题目。", used_ai: false, engine: "local-fallback" };
      }
      const item = generated.accepted[0];
      review.variant_question_id = item.id; review.updated_at = now(); save();
      return { ok: true, variant: item, reason: "本地变式题已生成，并已通过结构与答案校验。", used_ai: false, engine: "local" };
    }
    if (method === "POST" && path === "/api/questions/import") {
      const question = body.question;
      const required = ["title", "type", "difficulty", "stem", "answer", "explanation_short", "explanation", "target", "common_mistakes", "application"];
      const missing = required.filter((field) => question?.[field] === undefined || question?.[field] === "");
      if (missing.length) return fail(`缺少字段：${missing.join("、")}`);
      const id = `import-${uuid()}`;
      const item = { ...clone(question), id, logical_id: id, module_id: body.module_id, kp_id: body.kp_id, data: question.data || { options: question.options || [] }, tests: question.tests || [], source_type: "用户导入", validation_status: "用户导入·待人工确认", version: 1, created_at: now(), updated_at: now() };
      db.customQuestions.push(item); save();
      return { ok: true, question: { id, title: item.title } };
    }
    if (method === "PUT" && path.startsWith("/api/questions/")) {
      const id = path.split("/").pop();
      const question = db.customQuestions.find((item) => item.id === id);
      if (!question) return fail("内置种子题不允许在线编辑。", 403);
      Object.assign(question, clone(body.question), { id, updated_at: now(), version: (question.version || 1) + 1 });
      save();
      return { ok: true, question: safeQuestion(question, true) };
    }
    if (method === "DELETE" && path.startsWith("/api/questions/")) {
      if (!body.confirm) return fail("删除题目需要明确确认。");
      const id = path.split("/").pop();
      const used = db.attempts.some((a) => a.question_id === id) || db.dailyTasks.some((t) => t.question_id === id) || db.reviews.some((r) => r.question_id === id);
      if (used) {
        const question = db.customQuestions.find((item) => item.id === id);
        if (question) question.validation_status = "rejected";
        save();
        return { ok: true, archived: true, message: "题目已有学习记录，已从题库隐藏。" };
      }
      db.customQuestions = db.customQuestions.filter((item) => item.id !== id); save();
      return { ok: true, archived: false, message: "题目已删除。" };
    }
    if (method === "PUT" && path.startsWith("/api/milestones/")) {
      const milestone = db.milestones.find((item) => item.id === path.split("/").pop());
      if (!milestone) throw Object.assign(new Error("里程碑不存在。"), { status: 404 });
      Object.assign(milestone, { status: body.status || "todo", evidence: String(body.evidence || ""), updated_at: now() });
      save();
      return { ok: true, milestone };
    }
    if (method === "POST" && path === "/api/interviews") {
      const count = Math.max(4, Math.min(10, Number(body.count || 6)));
      const pool = allQuestions().filter((q) => ["interview", "scenario", "test_plan", "test_case_design"].includes(q.type));
      const questions = pool.sort(() => Math.random() - 0.5).slice(0, count).map((q) => ({ id: q.id, title: q.title, type: q.type, difficulty: q.difficulty, module_id: q.module_id, kp_id: q.kp_id, stem: q.stem, rubric: q.data?.rubric || [] }));
      const interview = { id: `int-${uuid()}`, title: body.title || `模拟面试 ${today()}`, mode: "self_assessed", status: "in_progress", questions, answers: Array(questions.length).fill(null), score: null, strengths: "", weaknesses: "", created_at: now(), completed_at: null };
      db.interviews.push(interview); save();
      return { ok: true, id: interview.id, questions };
    }
    if (method === "PUT" && path.startsWith("/api/interviews/")) {
      const interview = db.interviews.find((item) => item.id === path.split("/").pop());
      if (!interview) throw Object.assign(new Error("模拟面试不存在。"), { status: 404 });
      if (!Array.isArray(body.answers) || body.answers.length !== interview.questions.length) return fail("答案数量必须与题目一致。");
      interview.answers = body.answers.map((answer) => ({ ...answer, self_score: Math.max(0, Math.min(100, Number(answer.self_score || 0))) }));
      interview.score = interview.answers.reduce((sum, answer) => sum + answer.self_score, 0) / interview.answers.length;
      interview.status = body.finish ? "completed" : "in_progress";
      interview.completed_at = body.finish ? now() : null;
      interview.strengths = interview.questions.filter((q, index) => interview.answers[index].self_score >= 80).map((q) => q.title).join("；") || "尚无明显高分项";
      interview.weaknesses = interview.questions.filter((q, index) => interview.answers[index].self_score < 60).map((q) => q.title).join("；") || "暂无低于 60 分的自评项";
      save();
      return { ok: true, score: interview.score, strengths: interview.strengths, weaknesses: interview.weaknesses, status: interview.status, notice: "分数为对照评分标准的自评，不是自动面试官评分。" };
    }
    if (method === "POST" && path === "/api/import") return importPayload(body.backup, body.mode || "merge", Boolean(body.confirm));
    if (method === "POST" && path.startsWith("/api/mindmap/") && path.endsWith("/edges")) {
      const moduleId = path.split("/")[3];
      if (body.from_kp_id === body.to_kp_id) return fail("起点和终点不能相同。");
      const owned = seed.knowledge_points.filter((point) => point.module_id === moduleId && [body.from_kp_id, body.to_kp_id].includes(point.id));
      if (owned.length !== 2) return fail("知识点不存在或不属于当前模块。");
      if (db.edges.some((edge) => edge.module_id === moduleId && edge.from_kp_id === body.from_kp_id && edge.to_kp_id === body.to_kp_id)) return fail("这条知识关系已经存在。", 409);
      const edge = { id: nextId++, module_id: moduleId, from_kp_id: body.from_kp_id, to_kp_id: body.to_kp_id, label: body.label || "相关", is_custom: 1 };
      db.edges.push(edge); save();
      return { ok: true, id: edge.id };
    }
    if (method === "DELETE" && path.startsWith("/api/mindmap/edges/")) {
      if (!body.confirm) return fail("删除知识关系需要明确确认。");
      const id = Number(path.split("/").pop());
      const edge = db.edges.find((item) => item.id === id);
      if (!edge) return fail("知识关系不存在。", 404);
      if (!edge.is_custom) return fail("课程内置关系不可删除。", 403);
      db.edges = db.edges.filter((item) => item.id !== id); save();
      return { ok: true };
    }
    throw Object.assign(new Error("接口不存在。"), { status: 404 });
  }

  window.fetch = async (input, init = {}) => {
    let url;
    try { url = new URL(typeof input === "string" ? input : input.url, location.href); }
    catch { return nativeFetch(input, init); }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return nativeFetch(input, init);
    }
    await ready;
    const method = String(init.method || "GET").toUpperCase();
    let body = {};
    if (init.body) {
      try { body = JSON.parse(String(init.body)); } catch { return fail("请求 JSON 格式不合法。"); }
    }
    try {
      const result = await handle(url.pathname, method, url.searchParams, body);
      if (result instanceof Response) return result;
      return json(result);
    } catch (error) {
      console.error(error);
      return fail(error.message || "在线学习版处理失败。", error.status || 500);
    }
  };

  function renderOnlineBanner() {
    const banner = document.getElementById("online-mode-banner");
    if (banner) {
      banner.hidden = false;
      if (!useCloud) {
        banner.innerHTML = '在线学习版：记录保存在当前浏览器 · Python/C++ 在线判题已启用 · <span id="cloud-sync-status">浏览器记录</span>';
      }
    }
    document.body.classList.add("online-edition");
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", renderOnlineBanner);
  } else {
    renderOnlineBanner();
  }
})();

