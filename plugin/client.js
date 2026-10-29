window.__ModuleLoader__.load({
  id: "dsh-qtrans",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;

    const NS = "qtrans";
    const inject = ["slots", "locale"];

    const DICT = {
      zh: {
        trigger: "跃迁",
        export: "导出会话（下载 ZIP）",
        send: "上传到另一台",
        recv: "从另一台取回",
        import: "从文件导入…",
        exporting: "正在打包…",
        exportingOk: "已开始下载",
        sending: "正在上传…",
        receiving: "正在取回…",
        importing: "正在导入…",
        close: "关闭",
        settingsTitle: "DSH 跃迁",
        settingsDesc: "把配置和会话搬到另一台机器。会话不绑目录：导入时按当前项目重新挂载。这里配置两台机器之间的 WebDAV 中转。",
        webdavUrl: "WebDAV 地址",
        webdavUrlHint: "例如 https://dav.example.com/remote.php/dav/files/me/dsh/",
        username: "用户名",
        passwordEnv: "密码环境变量名",
        passwordEnvHint: "密码不写进配置文件，这里填环境变量名，例如 DSH_WEBDAV_PASSWORD",
        prefix: "远端目录",
        save: "保存",
        saving: "保存中…",
        saved: "已保存，配置立即生效",
        testConn: "测试连接",
        testing: "测试中…",
        testOk: "连接正常，可读写",
        testFail: "连接失败",
        notConfigured: "未配置 WebDAV",
        sessionsRoot: "会话目录",
        outDir: "导出目录",
      },
      en: {
        trigger: "QT",
        export: "Export session (download ZIP)",
        send: "Upload to the other machine",
        recv: "Fetch from the other machine",
        import: "Import from file…",
        exporting: "Packaging…",
        exportingOk: "Download started",
        sending: "Uploading…",
        receiving: "Fetching…",
        importing: "Importing…",
        close: "Close",
        settingsTitle: "DSH Quantum Transition",
        settingsDesc: "Move configuration and sessions between machines. Sessions are not bound to a directory: an import rebinds the session to the current project. Configure the WebDAV relay here.",
        webdavUrl: "WebDAV URL",
        webdavUrlHint: "e.g. https://dav.example.com/remote.php/dav/files/me/dsh/",
        username: "Username",
        passwordEnv: "Password env var",
        passwordEnvHint: "The password is never stored here — name the environment variable, e.g. DSH_WEBDAV_PASSWORD",
        prefix: "Remote folder",
        save: "Save",
        saving: "Saving…",
        saved: "Saved — takes effect immediately",
        testConn: "Test connection",
        testing: "Testing…",
        testOk: "Reachable — read/write OK",
        testFail: "Connection failed",
        notConfigured: "No WebDAV configured",
        sessionsRoot: "Sessions directory",
        outDir: "Export directory",
      },
    };

    const CSS = `
.qtr-root{position:relative;display:inline-flex;align-items:center}
.qtr-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer}
.qtr-trigger:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.qtr-trigger[data-open="true"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.qtr-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:60;min-width:250px;padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px rgba(0,0,0,.28)}
.qtr-item{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.qtr-item:hover{background:var(--dsw-alias-bg-layer-2)}
.qtr-item:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default}
.qtr-note{margin:6px 4px 2px;font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--dsw-alias-label-secondary)}
.qtr-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.qtr-note[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.qtr-page{display:grid;gap:14px;max-width:620px}
.qtr-h{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.qtr-p{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.qtr-field{display:grid;gap:6px}
.qtr-label{font-size:12px;color:var(--dsw-alias-label-primary)}
.qtr-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.qtr-input{width:100%;box-sizing:border-box;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}
.qtr-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.qtr-btn{justify-self:start;height:32px;padding:0 16px;border-radius:8px;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff;font-size:13px;cursor:pointer}
.qtr-btn:disabled{opacity:.55;cursor:default}
.qtr-row{display:flex;gap:8px;align-items:center;justify-self:start}
.qtr-btn--ghost{background:transparent;color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.qtr-meta{display:grid;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
`;

    function styles(ctx) {
      ctx.effect(() => {
        const el = document.createElement("style");
        el.setAttribute("data-plugin-css", NS);
        el.textContent = CSS;
        document.head.appendChild(el);
        return () => el.remove();
      }, NS + ": styles");
    }

    async function callJson(url, init) {
      const res = await fetch(url, init);
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON error body */
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status);
      return data;
    }

    function makeActions(t) {
      return function PortActions(props) {
        const sessionId = props && props.sessionId;
        const [open, setOpen] = React.useState(false);
        const [busy, setBusy] = React.useState("");
        const [note, setNote] = React.useState(null);
        const fileRef = React.useRef(null);
        const rootRef = React.useRef(null);

        React.useEffect(() => {
          if (!open) return undefined;
          const onDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
          };
          document.addEventListener("mousedown", onDown);
          return () => document.removeEventListener("mousedown", onDown);
        }, [open]);

        if (!sessionId) return null;

        const run = async (label, fn) => {
          setBusy(label);
          setNote(null);
          try {
            const message = await fn();
            setNote({ tone: "ok", text: message || "" });
          } catch (error) {
            setNote({ tone: "error", text: error && error.message ? error.message : String(error) });
          } finally {
            setBusy("");
          }
        };

        const onExport = () =>
          run(t("exporting"), async () => {
            const url = "/api/qtrans/export?sessionId=" + encodeURIComponent(sessionId);
            const head = await fetch(url, { method: "HEAD" });
            if (!head.ok) throw new Error("导出失败：HTTP " + head.status);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "dsh-session-" + sessionId + ".dshsess.zip";
            anchor.click();
            return t("exportingOk");
          });

        const onSend = () =>
          run(t("sending"), async () => {
            const data = await callJson("/api/qtrans/send?sessionId=" + encodeURIComponent(sessionId), {
              method: "POST",
            });
            return data.message;
          });

        const onRecv = () =>
          run(t("receiving"), async () => {
            const data = await callJson("/api/qtrans/recv?sessionId=" + encodeURIComponent(sessionId), {
              method: "POST",
            });
            return data.message;
          });

        const onFile = (event) => {
          const file = event.target.files && event.target.files[0];
          event.target.value = "";
          if (!file) return;
          run(t("importing"), async () => {
            const body = await file.arrayBuffer();
            const data = await callJson("/api/qtrans/import?sessionId=" + encodeURIComponent(sessionId), {
              method: "POST",
              headers: { "content-type": "application/zip" },
              body,
            });
            return data.message;
          });
        };

        const item = (label, onClick, disabled) =>
          h("button", { type: "button", className: "qtr-item", onClick, disabled }, label);

        return h(
          "div",
          { className: "qtr-root", ref: rootRef },
          h(
            "button",
            {
              type: "button",
              className: "qtr-trigger",
              "data-open": open ? "true" : "false",
              onClick: () => setOpen((v) => !v),
              title: t("trigger"),
            },
            t("trigger")
          ),
          open
            ? h(
                "div",
                { className: "qtr-panel" },
                item(t("export"), onExport, Boolean(busy)),
                item(t("send"), onSend, Boolean(busy)),
                item(t("recv"), onRecv, Boolean(busy)),
                item(t("import"), () => fileRef.current && fileRef.current.click(), Boolean(busy)),
                busy ? h("div", { className: "qtr-note" }, busy) : null,
                note
                  ? h("div", { className: "qtr-note", "data-tone": note.tone }, note.text)
                  : null,
                h("input", {
                  ref: fileRef,
                  type: "file",
                  accept: ".zip,.dshsess.zip",
                  style: { display: "none" },
                  onChange: onFile,
                })
              )
            : null
        );
      };
    }

    function makeSettings(t) {
      return function QTransPluginConfig(props) {
        // Rendered by `plugins.bundle.config`: `summary` is the one-liner on the
        // bundle row, `page` is the form on the bundle's own page.
        const view = (props && props.view) || "page";
        const [state, setState] = React.useState(null);
        const [saving, setSaving] = React.useState(false);
        const [testing, setTesting] = React.useState(false);
        const [note, setNote] = React.useState(null);

        React.useEffect(() => {
          let alive = true;
          callJson("/api/qtrans/settings")
            .then((data) => {
              if (alive) setState(data.settings);
            })
            .catch((error) => {
              if (alive) setNote({ tone: "error", text: error.message });
            });
          return () => {
            alive = false;
          };
        }, []);

        const field = (key, labelKey, hintKey, value, onChange) =>
          h(
            "label",
            { className: "qtr-field" },
            h("span", { className: "qtr-label" }, t(labelKey)),
            h("input", {
              className: "qtr-input",
              value: value || "",
              onChange: (event) => onChange(event.target.value),
              spellCheck: false,
            }),
            hintKey ? h("span", { className: "qtr-hint" }, t(hintKey)) : null
          );

        if (view === "summary") {
          const url = state && state.webdav ? state.webdav.url : "";
          return h("span", { className: "qtr-hint" }, url || t("notConfigured"));
        }

        if (!state) {
          return h(
            "div",
            { className: "qtr-page" },
            h("div", { className: "qtr-h" }, t("settingsTitle")),
            h("p", { className: "qtr-p" }, note ? note.text : "…")
          );
        }

        const webdav = state.webdav || {};
        const setWebdav = (patch) =>
          setState({ ...state, webdav: { ...webdav, ...patch } });

        const save = async () => {
          setSaving(true);
          setNote(null);
          try {
            await callJson("/api/qtrans/settings", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ webdav }),
            });
            setNote({ tone: "ok", text: t("saved") });
          } catch (error) {
            setNote({ tone: "error", text: error.message });
          } finally {
            setSaving(false);
          }
        };

        // Probe round-trips MKCOL -> PUT -> HEAD -> DELETE on the server, so a
        // green result means bundles can actually be stored there.
        const test = async () => {
          setTesting(true);
          setNote(null);
          try {
            await callJson("/api/qtrans/settings", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ webdav }),
            });
            const data = await callJson("/api/qtrans/ping", { method: "POST" });
            setNote({ tone: "ok", text: `${t("testOk")} · ${data.ms}ms · ${data.bytes}B@${data.prefix}` });
          } catch (error) {
            setNote({ tone: "error", text: `${t("testFail")}: ${error.message}` });
          } finally {
            setTesting(false);
          }
        };

        return h(
          "div",
          { className: "qtr-page" },
          h("div", { className: "qtr-h" }, t("settingsTitle")),
          h("p", { className: "qtr-p" }, t("settingsDesc")),
          field("url", "webdavUrl", "webdavUrlHint", webdav.url, (v) => setWebdav({ url: v })),
          field("username", "username", null, webdav.username, (v) => setWebdav({ username: v })),
          field("passwordEnv", "passwordEnv", "passwordEnvHint", webdav.passwordEnv, (v) =>
            setWebdav({ passwordEnv: v })
          ),
          field("prefix", "prefix", null, webdav.prefix, (v) => setWebdav({ prefix: v })),
          h(
            "div",
            { className: "qtr-row" },
            h(
              "button",
              { type: "button", className: "qtr-btn", onClick: save, disabled: saving || testing },
              saving ? t("saving") : t("save")
            ),
            h(
              "button",
              {
                type: "button",
                className: "qtr-btn qtr-btn--ghost",
                onClick: test,
                disabled: saving || testing,
              },
              testing ? t("testing") : t("testConn")
            )
          ),
          note ? h("div", { className: "qtr-note", "data-tone": note.tone }, note.text) : null,
          h(
            "div",
            { className: "qtr-meta" },
            h("span", null, t("sessionsRoot") + ": " + state.sessionsRoot),
            h("span", null, t("outDir") + ": " + state.outDir)
          )
        );
      };
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICT), NS + ": locale");
      const t = ctx.locale.bind(NS);
      styles(ctx);

      const Actions = makeActions(t);
      const Settings = makeSettings(t);

      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "qtrans-actions",
            locale: NS,
          },
          Actions
        )
      );

      // Same placement as dsh-context: the config form lives on the bundle's own
      // page under Settings → Plugins, keyed by the package name.
      ctx.slots.inject("plugins.bundle.config", () =>
        ctx.slots.register(
          {
            name: "plugins.bundle.config",
            key: "dsh-qtrans",
            locale: NS,
          },
          Settings
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
