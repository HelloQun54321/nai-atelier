// Windows 消息驱动的剪贴板监听与不激活置顶窗；普通文本在此进程内直接丢弃。
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// 状态点仅在真实处理阶段轻微呼吸；等待与暂停时不运行动画计时器。
public sealed class CollectorStatusDot : Control {
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint parameter, ref int value, uint flags);
    readonly System.Windows.Forms.Timer animation = new System.Windows.Forms.Timer();
    readonly bool animationsAllowed;
    bool breathing;
    public bool Processing { get; private set; }
    public bool Breathing { get { return breathing; } }
    public void SetProcessing(bool value) { Processing = value; bool next = value && animationsAllowed; if (breathing == next) return; breathing = next; if (next) animation.Start(); else animation.Stop(); Invalidate(); }
    public CollectorStatusDot() {
        SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.Transparent; animation.Interval = 120; animation.Tick += delegate { Invalidate(); };
        int enabled = 1; animationsAllowed = !SystemParametersInfo(0x1042, 0, ref enabled, 0) || enabled != 0;
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        int alpha = breathing ? 160 + (int)(70 * (0.5 + 0.5 * Math.Sin(DateTime.UtcNow.TimeOfDay.TotalSeconds * Math.PI))) : 230;
        using (var brush = new SolidBrush(Color.FromArgb(alpha, ForeColor))) e.Graphics.FillEllipse(brush, 2, 2, 8, 8);
    }
    protected override void Dispose(bool disposing) { if (disposing) animation.Dispose(); base.Dispose(disposing); }
}

// 四列固定起点，标签弱化、数字突出；长计数省略，避免挤到相邻指标。
public sealed class CollectorMetrics : Control {
    public int Pending, Saved, Skipped, Failed;
    public readonly Color Muted = Color.FromArgb(151, 160, 174), Success = Color.FromArgb(152, 196, 172), Failure = Color.FromArgb(222, 153, 157);
    readonly Font numberFont = new Font("Microsoft YaHei UI", 9, FontStyle.Bold);
    public CollectorMetrics() { SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true); BackColor = Color.Transparent; }
    protected override void OnPaint(PaintEventArgs e) {
        string[] labels = { "待处理", "已保存", "跳过", "失败" }; int[] values = { Pending, Saved, Skipped, Failed };
        for (int i = 0; i < 4; i++) {
            int x = i * Width / 4;
            var flags = TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            int labelWidth = i < 2 ? 39 : 27;
            TextRenderer.DrawText(e.Graphics, labels[i], Font, new Rectangle(x, 0, labelWidth, Height), Muted, flags);
            Color color = i == 1 && values[i] > 0 ? Success : i == 3 && values[i] > 0 ? Failure : ForeColor;
            TextRenderer.DrawText(e.Graphics, values[i].ToString(), numberFont, new Rectangle(x + labelWidth + 3, 0, Width / 4 - labelWidth - 7, Height), color, flags);
        }
    }
    protected override void Dispose(bool disposing) { if (disposing) numberFont.Dispose(); base.Dispose(disposing); }
}

public sealed class AtelierCollectorWindow : Form {
    [DllImport("user32.dll", SetLastError=true)] static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr memory);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);
    [StructLayout(LayoutKind.Sequential)] struct Margins { public int Left, Right, Top, Bottom; }
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly ConcurrentQueue<string> input = new ConcurrentQueue<string>();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Label title = new Label(), phase = new Label(), detail = new Label(), failureHint = new Label();
    readonly CollectorStatusDot statusDot = new CollectorStatusDot();
    readonly CollectorMetrics metrics = new CollectorMetrics();
    readonly ToolTip detailTip = new ToolTip();
    readonly Button pause = new Button(), collapse = new Button(), finish = new Button();
    readonly bool test;
    volatile bool eof;
    bool receiving, registered, collapsed, applyingPosition, paused, latestFailed, nativeCorners;
    string latestFailure = "";
    bool positionDirty;
    DateTime positionChanged;
    uint sequence;
    int readAttempts;
    string session = "";
    int saved;
    DateTime pulse = DateTime.MinValue;
    public AtelierCollectorWindow(bool selfTest) {
        test = selfTest; Text = "Atelier 风格串收集"; FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Color.FromArgb(30, 34, 42); ForeColor = Color.FromArgb(222, 227, 235);
        Font = new Font("Microsoft YaHei UI", 9); ClientSize = new Size(356, 122);
        statusDot.SetBounds(14, 15, 12, 12); statusDot.ForeColor = metrics.Success;
        title.SetBounds(32, 9, 154, 25); title.AutoEllipsis = true; title.Font = new Font(Font, FontStyle.Bold);
        phase.SetBounds(16, 39, 324, 19); phase.ForeColor = metrics.Muted;
        metrics.SetBounds(16, 61, 324, 23); metrics.ForeColor = ForeColor;
        detail.SetBounds(22, 91, 312, 22); detail.AutoEllipsis = true; detail.BackColor = Color.FromArgb(36, 41, 50);
        failureHint.SetBounds(195, 11, 17, 23); failureHint.Text = "●"; failureHint.ForeColor = metrics.Failure; failureHint.Visible = false;
        title.Text = "正在启动"; phase.Text = "等待本机服务确认";
        Configure(pause, "暂停", 222, 44); Configure(collapse, "−", 272, 28); Configure(finish, "×", 310, 28);
        finish.FlatAppearance.MouseOverBackColor = Color.FromArgb(75, 43, 50); finish.FlatAppearance.MouseDownBackColor = Color.FromArgb(92, 47, 56);
        finish.MouseEnter += delegate { finish.ForeColor = metrics.Failure; }; finish.MouseLeave += delegate { finish.ForeColor = metrics.Muted; };
        detailTip.SetToolTip(pause, "暂停接收新复制，已入队图片继续处理"); detailTip.SetToolTip(collapse, "折叠状态窗"); detailTip.SetToolTip(finish, "结束收集");
        detailTip.ShowAlways = true; detailTip.InitialDelay = 350; detailTip.ReshowDelay = 100; detailTip.AutoPopDelay = 10000;
        Controls.AddRange(new Control[]{ statusDot, title, phase, metrics, detail, failureHint, pause, collapse, finish });
        pause.Click += delegate { receiving = false; Emit(new { type = paused ? "resume" : "pause", session = session }); pause.Enabled = false; };
        collapse.Click += delegate { collapsed = !collapsed; LayoutWindow(); SavePosition(); };
        finish.Click += delegate { Close(); };
        MouseDown += Drag; title.MouseDown += Drag; phase.MouseDown += Drag; metrics.MouseDown += Drag; statusDot.MouseDown += Drag;
        detail.MouseDown += Drag;
        LocationChanged += delegate { if (!applyingPosition && session != "") { positionDirty = true; positionChanged = DateTime.UtcNow; } };
        FormClosed += delegate { if (positionDirty) SavePosition(); if (registered) RemoveClipboardFormatListener(Handle); receiving = false; Emit(new { type = "stop", session = session }); };
        Shown += delegate { Emit(new { type = "ready" }); };
        timer.Interval = 50;
        timer.Tick += Tick; timer.Start();
        Thread reader = new Thread(delegate() {
            try { string line; while ((line = Console.ReadLine()) != null) input.Enqueue(line); } catch { }
            eof = true;
        }); reader.IsBackground = true; reader.Start();
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000080; p.ClassStyle |= 0x00020000; return p; } }
    static GraphicsPath Rounded(RectangleF bounds, float radius) {
        var path = new GraphicsPath(); float diameter = radius * 2;
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90); path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90); path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90); path.CloseFigure(); return path;
    }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        // 新版 Windows 使用 DWM 圆角与原生阴影；旧系统保留圆角区域与类阴影。
        try { int corner = 2; nativeCorners = DwmSetWindowAttribute(Handle, 33, ref corner, 4) == 0; var margins = new Margins { Left = 1, Right = 1, Top = 1, Bottom = 1 }; DwmExtendFrameIntoClientArea(Handle, ref margins); } catch (DllNotFoundException) { }
        UpdateCorners();
    }
    void UpdateCorners() {
        if (!nativeCorners) { using (var path = Rounded(new RectangleF(0, 0, Width, Height), 12)) { var old = Region; Region = new Region(path); if (old != null) old.Dispose(); } }
    }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var border = Rounded(new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), 12))
        using (var pen = new Pen(Color.FromArgb(56, 63, 75))) e.Graphics.DrawPath(pen, border);
        if (!collapsed) using (var footer = Rounded(new RectangleF(16, 90, 324, 24), 6))
            using (var brush = new SolidBrush(detail.BackColor)) e.Graphics.FillPath(brush, footer);
    }
    void Configure(Button b, string text, int x, int width) {
        b.Text = text; b.SetBounds(x, 7, width, 28); b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = 0; b.BackColor = BackColor; b.ForeColor = metrics.Muted; b.TabStop = false; b.UseVisualStyleBackColor = false;
        b.FlatAppearance.MouseOverBackColor = Color.FromArgb(45, 51, 63); b.FlatAppearance.MouseDownBackColor = Color.FromArgb(53, 60, 73);
        using (var path = Rounded(new RectangleF(0, 0, width, 28), 6)) b.Region = new Region(path);
    }
    void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    void Drag(object sender, MouseEventArgs e) { if (e.Button != MouseButtons.Left) return; ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); SavePosition(); }
    void LayoutWindow() {
        ClientSize = new Size(356, collapsed ? 43 : 122); phase.Visible = metrics.Visible = detail.Visible = !collapsed;
        title.Text = (paused ? "已暂停" : "收集中") + (collapsed ? " · 已保存 " + saved.ToString() : "");
        detailTip.SetToolTip(title, title.Text); failureHint.Visible = collapsed && latestFailed; detailTip.SetToolTip(failureHint, latestFailure);
        statusDot.ForeColor = paused ? Color.FromArgb(199, 179, 133) : metrics.Success;
        statusDot.SetProcessing(!paused && (phase.Text == "正在下载图片" || phase.Text == "正在解析图片" || phase.Text == "正在保存风格串"));
        collapse.Text = collapsed ? "+" : "−"; detailTip.SetToolTip(collapse, collapsed ? "展开状态窗" : "折叠状态窗"); UpdateCorners(); ClampPosition(); Invalidate();
    }
    void ClampPosition() {
        Rectangle area = Screen.FromRectangle(Bounds).WorkingArea;
        applyingPosition = true;
        Location = new Point(Math.Max(area.Left, Math.Min(Left, area.Right - Width)), Math.Max(area.Top, Math.Min(Top, area.Bottom - Height)));
        applyingPosition = false;
    }
    void SavePosition() { positionDirty = false; Emit(new { type = "position", session = session, x = Left, y = Top, collapsed = collapsed }); }
    uint CurrentSequence() { return test ? sequence : GetClipboardSequenceNumber(); }
    void ReadClipboard() {
        if (!receiving || test) return;
        if (!OpenClipboard(Handle)) { readAttempts++; return; }
        uint observed = GetClipboardSequenceNumber();
        try {
            if (IsClipboardFormatAvailable(2) || IsClipboardFormatAvailable(8) || IsClipboardFormatAvailable(17)) return;
            if (!IsClipboardFormatAvailable(13)) return;
            IntPtr memory = GetClipboardData(13); if (memory == IntPtr.Zero || GlobalSize(memory).ToUInt64() > 16386) return;
            IntPtr value = GlobalLock(memory); if (value == IntPtr.Zero) return;
            try { Candidate(Marshal.PtrToStringUni(value)); } finally { GlobalUnlock(memory); }
        } finally { CloseClipboard(); sequence = observed; readAttempts = 0; }
    }
    public static bool IsCandidate(string text) {
        if (String.IsNullOrWhiteSpace(text) || text.Length > 8192) return false;
        text = text.Trim(); if (Regex.IsMatch(text, @"\s")) return false;
        Uri uri;
        if (!Uri.TryCreate(text, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo != "") return false;
        return Regex.IsMatch(Uri.UnescapeDataString(uri.AbsolutePath), @"\.(png|jpe?g|webp|gif|avif)$", RegexOptions.IgnoreCase)
            || ((uri.Host == "cdn.discordapp.com" || uri.Host == "media.discordapp.net") && Regex.IsMatch(uri.AbsolutePath, @"^/attachments/\d+/\d+/"));
    }
    void Candidate(string text) { if (receiving && IsCandidate(text)) Emit(new { type = "link", session = session, url = text.Trim() }); }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x21) { m.Result = new IntPtr(3); return; } // MA_NOACTIVATE，点击不夺走原应用焦点。
        if (m.Msg == 0x031D && receiving) { uint now = GetClipboardSequenceNumber(); if (now != sequence) { readAttempts = 0; ReadClipboard(); } }
        if (m.Msg == 0x007E) ClampPosition(); // 显示器配置改变。
        base.WndProc(ref m);
    }
    static string Str(Dictionary<string, object> d, string key) { return d.ContainsKey(key) ? Convert.ToString(d[key]) : ""; }
    void Tick(object sender, EventArgs args) {
        if (eof) { Close(); return; }
        if (positionDirty && (DateTime.UtcNow - positionChanged).TotalMilliseconds > 300) SavePosition();
        if (readAttempts > 0 && readAttempts < 4) ReadClipboard();
        string line;
        while (input.TryDequeue(out line)) {
            try {
                var d = json.Deserialize<Dictionary<string, object>>(line);
                string cmd = Str(d, "command"), incoming = Str(d, "session");
                if (cmd == "start" && session == "") {
                    session = incoming;
                    applyingPosition = true;
                    var pos = d.ContainsKey("position") ? d["position"] as Dictionary<string, object> : null;
                    if (pos != null && pos.ContainsKey("x") && pos.ContainsKey("y")) {
                        Location = new Point(Convert.ToInt32(pos["x"]), Convert.ToInt32(pos["y"])); collapsed = pos.ContainsKey("collapsed") && Convert.ToBoolean(pos["collapsed"]);
                    } else { Rectangle area = Screen.PrimaryScreen.WorkingArea; Location = new Point(area.Right - Width - 24, area.Top + 24); }
                    applyingPosition = false; LayoutWindow();
                    sequence = CurrentSequence();
                    if (!test && !AddClipboardFormatListener(Handle)) throw new Exception("无法注册 Windows 剪贴板变化通知");
                    registered = !test; receiving = true;
                    SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
                    Emit(new { type = "listening", session = session });
                    if (test) ReportWindow();
                } else if (incoming != session) continue;
                else if (cmd == "pause" || cmd == "resume") {
                    paused = cmd == "pause"; receiving = !paused; sequence = CurrentSequence(); readAttempts = 0;
                    pause.Text = paused ? "继续" : "暂停"; pause.Enabled = true; LayoutWindow();
                    detailTip.SetToolTip(pause, paused ? "继续接收之后的新复制" : "暂停接收新复制，已入队图片继续处理");
                } else if (cmd == "stop") { receiving = false; Close(); return; }
                else if (cmd == "state") {
                    var state = d["state"] as Dictionary<string, object>;
                    if (state != null) {
                        saved = Convert.ToInt32(state["saved"]); paused = Convert.ToBoolean(state["paused"]);
                        phase.Text = Str(state, "stage");
                        metrics.Pending = Convert.ToInt32(state["pending"]); metrics.Saved = saved; metrics.Skipped = Convert.ToInt32(state["skipped"]); metrics.Failed = Convert.ToInt32(state["failed"]); metrics.Invalidate();
                        detailTip.SetToolTip(metrics, "待处理 " + metrics.Pending + " · 已保存 " + saved + " · 跳过 " + metrics.Skipped + " · 失败 " + metrics.Failed);
                        detail.Text = Str(state, "error") != "" ? Str(state, "error") : Str(state, "detail");
                        latestFailed = detail.Text.StartsWith("失败：") || Str(state, "error") != ""; latestFailure = latestFailed ? detail.Text : "";
                        detail.ForeColor = latestFailed ? metrics.Failure : detail.Text.StartsWith("已保存：") ? metrics.Success : metrics.Muted;
                        detailTip.SetToolTip(detail, detail.Text);
                        LayoutWindow();
                        if (test) ReportWindow();
                    }
                } else if (test && cmd == "inject") { sequence++; Candidate(Str(d, "text")); }
                else if (test && cmd == "collapse") { collapse.PerformClick(); ReportWindow(); }
                else if (test && cmd == "snapshot") {
                    using (var bitmap = new Bitmap(Width, Height)) { DrawToBitmap(bitmap, new Rectangle(0, 0, Width, Height)); bitmap.Save(Str(d, "path"), System.Drawing.Imaging.ImageFormat.Png); }
                }
                if (d.ContainsKey("id")) Emit(new { type = "ack", session = session, id = Str(d, "id") });
            } catch (Exception e) { Emit(new { type = "error", session = session, error = e.Message }); receiving = false; Close(); return; }
        }
        if ((DateTime.UtcNow - pulse).TotalSeconds > 2) { pulse = DateTime.UtcNow; Emit(new { type = "pulse", session = session }); }
    }
    void ReportWindow() {
        Rectangle area = Screen.FromRectangle(Bounds).WorkingArea;
        Emit(new { type = "window", session = session, noActivate = (GetWindowLong(Handle, -20) & 0x08000000) != 0,
            topMost = (GetWindowLong(Handle, -20) & 8) != 0, foreground = GetForegroundWindow() == Handle,
            visiblePosition = area.Contains(Bounds), collapsed = collapsed, height = Height, detail = detail.Text, detailVisible = detail.Visible, detailEllipsis = detail.AutoEllipsis,
            title = title.Text, breathing = statusDot.Breathing, processing = statusDot.Processing, tooltipWhileInactive = detailTip.ShowAlways, failureHint = failureHint.Visible, failureTooltip = detailTip.GetToolTip(failureHint), rounded = nativeCorners || Region != null,
            counters = new { pending = metrics.Pending, saved = metrics.Saved, skipped = metrics.Skipped, failed = metrics.Failed } });
    }
    [STAThread] public static void Run(bool test) { Application.EnableVisualStyles(); Application.Run(new AtelierCollectorWindow(test)); }
}
