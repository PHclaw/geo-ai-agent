/* ============================================================
   GEO AI Agent — 工作台共享外壳与交互
   侧栏 / 顶栏由 JS 注入，保证 8 个页面导航一致
   ============================================================ */
(function () {
  "use strict";

  var ICONS = {
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/><path d="M12 12l6-6"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/>',
    book: '<path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z"/><path d="M8 4.5V17a3 3 0 0 0 3 3"/>',
    box: '<path d="M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7l8-4.2z"/><path d="M4 7.7l8 4.3 8-4.3"/><path d="M12 12v8.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5z"/>',
    pen: '<path d="M15.5 4.5l4 4-9.5 9.5-4.5.5.5-4.5 9.5-9.5z"/><path d="M14 6l4 4"/>',
    send: '<path d="M4 11.5l16-7-6 15-3.2-6.1L4 11.5z"/><path d="M10.8 13.4L20 4.5"/>',
    chart: '<path d="M4 19.5h16"/><path d="M7 19.5v-6"/><path d="M12 19.5V6.5"/><path d="M17 19.5v-9"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M4.6 12H6.8M17.2 12h2.2M6.7 6.7l1.6 1.6M15.7 15.7l1.6 1.6M17.3 6.7l-1.6 1.6M8.3 15.7l-1.6 1.6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    bell: '<path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15L18 15.5z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/><path d="M16 5.6a3 3 0 0 1 0 5.8"/><path d="M17.5 14.6c2 .6 3.5 2.4 3.5 4.9"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"/>',
    video: '<rect x="3" y="6" width="12" height="12" rx="2.6"/><path d="M15 11.2l5.5-3.2v9l-5.5-3.2"/>',
    home: '<path d="M4 10.5L12 4l8 6.5V20H4v-9.5z"/>'
  };

  var NAV = [
    {
      label: "总览",
      items: [{ href: "dashboard.html", key: "dashboard", label: "工作台", icon: "grid" }]
    },
    {
      label: "① 诊断",
      items: [
        { href: "diagnosis.html", key: "diagnosis", label: "AI 全景诊断", icon: "radar" }
      ]
    },
    {
      label: "② 企业资产",
      items: [
        { href: "knowledge.html", key: "knowledge", label: "知识库", icon: "book" },
        { href: "products.html", key: "products", label: "产品库", icon: "box" },
        { href: "site.html", key: "site", label: "官网建站", icon: "globe" }
      ]
    },
    {
      label: "③ 内容",
      items: [
        { href: "content.html", key: "content", label: "内容创作", icon: "pen" },
        { href: "avatar.html", key: "avatar", label: "数字人与视频", icon: "video" }
      ]
    },
    {
      label: "④ 分发",
      items: [{ href: "media.html", key: "media", label: "媒体分发", icon: "send" }]
    },
    {
      label: "⑤ 复盘",
      items: [{ href: "monitor.html", key: "monitor", label: "监测与复盘", icon: "chart" }]
    },
    {
      label: "服务商",
      items: [{ href: "agency.html", key: "agency", label: "客户与白标", icon: "users" }]
    }
  ];

  function svg(name, size) {
    var s = size || 15;
    return (
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + (ICONS[name] || "") + "</svg>"
    );
  }

  function buildSidebar(page) {
    var out =
      '<a class="brand" href="dashboard.html" aria-label="GEO AI Agent">' +
      '<span class="mark"></span>GEO AI Agent<span class="ver">V1.0</span></a>';

    NAV.forEach(function (group) {
      out += '<nav class="nav-group" aria-label="' + group.label + '">';
      out += '<div class="nav-label">' + group.label + "</div>";
      group.items.forEach(function (it) {
        out +=
          '<a class="nav-item' + (it.key === page ? " active" : "") + '" href="' + it.href + '">' +
          svg(it.icon) + "<span>" + it.label + "</span>" +
          (it.key === "diagnosis" ? '<span class="tag">AVI 34</span>' : "") +
          "</a>";
      });
      out += "</nav>";
    });

    out +=
      '<nav class="nav-group" style="margin-top:auto">' +
      '<div class="nav-label">原型导航</div>' +
      '<a class="nav-item" href="login.html">' + svg("user") + "<span>登录页</span></a>" +
      '<a class="nav-item" href="wizard.html">' + svg("pen") + "<span>建档向导</span></a>" +
      '<a class="nav-item" href="../index.html">' + svg("home") + "<span>返回开始界面</span></a>" +
      '<a class="nav-item" href="#" data-toast="设置页在 V1.5 交付">' + svg("gear") + "<span>设置与成员</span></a>" +
      "</nav>" +
      '<div class="side-foot"><span class="dot-live"></span>探测正常 · 8 个平台在线</div>';

    return out;
  }

  function buildTopbar(page) {
    var body = document.body;
    var title = body.getAttribute("data-title") || "工作台";
    var crumb = body.getAttribute("data-crumb") || "工作台";
    return (
      '<button class="icon-btn menu-toggle" data-toggle-sidebar aria-label="打开导航">' +
      svg("menu", 16) + "</button>" +
      '<div><div class="crumb">' + crumb + "</div>" +
      '<h1 class="page-title">' + title + "</h1></div>" +
      '<div class="spacer"></div>' +
      '<label class="search">' + svg("search", 13) +
      '<input type="search" placeholder="搜索品牌 / 内容 / 媒体" aria-label="搜索" /></label>' +
      '<button class="icon-btn" data-toast="3 条未读通知：竞品超车 1 条、负面预警 1 条、任务完成 1 条" aria-label="通知">' +
      svg("bell", 15) + '<span class="pip"></span></button>' +
      '<div class="avatar" title="和序装饰 · 市场部">和序</div>'
    );
  }

  function init() {
    var page = document.body.getAttribute("data-page") || "";
    var sidebar = document.getElementById("sidebar");
    var topbar = document.getElementById("topbar");
    if (sidebar) sidebar.innerHTML = buildSidebar(page);
    if (topbar) topbar.innerHTML = buildTopbar(page);

    // 侧栏开关（移动端）
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-toggle-sidebar]");
      if (t && sidebar) sidebar.classList.toggle("open");
    });

    // 避免原型中的占位链接跳回顶部
    document.addEventListener("click", function (e) {
      var a = e.target.closest('a[href="#"]');
      if (a) e.preventDefault();
    });

    // Toast
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-toast]");
      if (t) {
        e.preventDefault();
        toast(t.getAttribute("data-toast"));
      }
    });

    // Segmented control
    document.querySelectorAll(".seg").forEach(function (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        seg.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        var t = b.getAttribute("data-toast");
        if (t) toast(t);
      });
    });

    // Tabs
    document.querySelectorAll("[data-tabs]").forEach(function (wrap) {
      var scope = wrap.getAttribute("data-tabs");
      wrap.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-tab]");
        if (!b) return;
        var id = b.getAttribute("data-tab");
        wrap.querySelectorAll("button[data-tab]").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        document.querySelectorAll('[data-pane-group="' + scope + '"]').forEach(function (p) {
          p.classList.toggle("on", p.getAttribute("data-pane") === id);
        });
      });
    });

    // Switch
    document.querySelectorAll(".switch").forEach(function (s) {
      s.addEventListener("click", function () { s.classList.toggle("on"); });
    });

    // Drawer
    var scrim = document.createElement("div");
    scrim.className = "scrim";
    document.body.appendChild(scrim);

    function closeDrawers() {
      document.querySelectorAll(".drawer.on").forEach(function (d) { d.classList.remove("on"); });
      scrim.classList.remove("on");
    }
    scrim.addEventListener("click", closeDrawers);

    document.addEventListener("click", function (e) {
      var open = e.target.closest("[data-open-drawer]");
      if (open) {
        var d = document.querySelector(open.getAttribute("data-open-drawer"));
        if (d) { d.classList.add("on"); scrim.classList.add("on"); }
        return;
      }
      var close = e.target.closest("[data-close-drawer]");
      if (close) { closeDrawers(); return; }
      // 整行可点开抽屉
      var row = e.target.closest("tr[data-row-drawer]");
      if (row) {
        var dd = document.querySelector(row.getAttribute("data-row-drawer"));
        if (dd) { dd.classList.add("on"); scrim.classList.add("on"); }
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawers();
    });

    // 进入视口后动画：进度条 / 漏斗 / 环 / 热力格
    animateOnView();
  }

  function animateOnView() {
    var targets = document.querySelectorAll(".bar > i, .funnel .tr > i");
    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.style.width = (el.getAttribute("data-w") || 0) + "%"; });
      document.querySelectorAll(".ring").forEach(function (r) {
        r.style.setProperty("--v", r.getAttribute("data-v") || 0);
      });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        if (el.classList.contains("ring")) {
          animateRing(el, parseFloat(el.getAttribute("data-v") || "0"));
        } else {
          el.style.width = (el.getAttribute("data-w") || "0") + "%";
        }
        io.unobserve(el);
      });
    }, { threshold: 0.25 });

    targets.forEach(function (el) { io.observe(el); });
    document.querySelectorAll(".ring").forEach(function (r) { io.observe(r); });
  }

  function animateRing(el, target) {
    var start = performance.now();
    var dur = 900;
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.style.setProperty("--v", (target * e).toFixed(2));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("on"); }, 2600);
  }
  window.geoToast = toast;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
