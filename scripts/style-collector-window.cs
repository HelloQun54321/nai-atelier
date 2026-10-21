// 自动监听只接图片链接；普通文本仅在用户点击收录后暂存于小窗，保存才传入工坊。
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

// 状态点仅在真实处理阶段轻微呼吸；等待与暂停时不运行动画计时器。
public sealed class CollectorStatusDot : Control {
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint parameter, ref int value, uint flags);
    readonly System.Windows.Forms.Timer animation = new System.Windows.Forms.Timer();
    readonly bool animationsAllowed;
    public bool MotionAllowed = true;
    bool breathing;
    public bool Processing { get; private set; }
    public bool Breathing { get { return breathing; } }
    public void SetProcessing(bool value) { Processing = value; bool next = value && animationsAllowed && MotionAllowed; if (breathing == next) return; breathing = next; if (next) animation.Start(); else animation.Stop(); Invalidate(); }
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
    public string[] Labels = { "待处理", "已保存", "跳过", "失败" };
    public Color Muted = Color.FromArgb(151, 160, 174), Success = Color.FromArgb(152, 196, 172), Failure = Color.FromArgb(222, 153, 157);
    readonly Font numberFont = new Font("Microsoft YaHei UI", 9, FontStyle.Bold);
    public CollectorMetrics() { SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true); BackColor = Color.Transparent; }
    public bool LabelsFit { get { foreach (string label in Labels) if (TextRenderer.MeasureText(label, Font, Size.Empty, TextFormatFlags.NoPadding).Width > Width / 4 - 27) return false; return true; } }
    protected override void OnPaint(PaintEventArgs e) {
        string[] labels = Labels; int[] values = { Pending, Saved, Skipped, Failed };
        for (int i = 0; i < 4; i++) {
            int x = i * Width / 4;
            var flags = TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            int labelWidth = Math.Min(Width / 4 - 27, Math.Max(i < 2 ? 39 : 27, TextRenderer.MeasureText(labels[i], Font, Size.Empty, TextFormatFlags.NoPadding).Width));
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
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string format);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr memory);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);
    [StructLayout(LayoutKind.Sequential)] struct Margins { public int Left, Right, Top, Bottom; }
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 20 * 1024 * 1024 };
    readonly ConcurrentQueue<string> input = new ConcurrentQueue<string>();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    Dictionary<string, object> labels = new Dictionary<string, object>();
    string rawStage = "";
    string T(string message) { return labels.ContainsKey(message) ? Convert.ToString(labels[message]) : message; }
    readonly Label title = new Label(), phase = new Label(), detail = new Label(), failureHint = new Label();
    readonly CollectorStatusDot statusDot = new CollectorStatusDot();
    readonly CollectorMetrics metrics = new CollectorMetrics();
    readonly ToolTip detailTip = new ToolTip();
    readonly Button pause = new Button(), collapse = new Button(), finish = new Button();
    readonly Button capture = new Button(), saveText = new Button(), cancelText = new Button();
    readonly Button styleMode = new Button(), collectionMode = new Button();
    string collectionTarget = "style";
    static readonly string[] captureCategoryKinds = new string[]{ "", "appearance", "wardrobe", "pose", "expression", "scene", "camera" };
    readonly TextBox captureName = new TextBox(), capturePreview = new TextBox();
    readonly ComboBox captureCategory = new ComboBox();
    readonly Label captureNameLabel = new Label(), captureCategoryLabel = new Label(), capturePreviewLabel = new Label(), captureStatus = new Label();
    string capturedText = "", captureId = "", categorySignature = "";
    bool captureSaving;
    IntPtr captureReturnFocus;
    readonly bool test;
    volatile bool eof;
    bool receiving, registered, collapsed, applyingPosition, paused, latestFailed, nativeCorners;
    string latestFailure = "";
    string themeMode = "system", motion = "full";
    bool dark = true, fallbackDark = true;
    bool? testSystemDark;
    Color accent = Color.FromArgb(14, 165, 233), borderColor = Color.FromArgb(56, 63, 75), pausedColor = Color.FromArgb(199, 179, 133);
    Dictionary<string, object> palette;
    bool positionDirty;
    DateTime positionChanged;
    uint sequence;
    int readAttempts;
    string session = "";
    int saved;
    DateTime pulse = DateTime.MinValue;
    public AtelierCollectorWindow(bool selfTest, string initialAppearance) {
        test = selfTest; Text = T("Atelier 收集"); FormBorderStyle = FormBorderStyle.None;
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
        title.Text = T("正在启动"); phase.Text = T("等待本机服务确认");
        Configure(pause, T("暂停"), 222, 44); Configure(collapse, "−", 272, 28); Configure(finish, "×", 310, 28);
        finish.FlatAppearance.MouseOverBackColor = Color.FromArgb(75, 43, 50); finish.FlatAppearance.MouseDownBackColor = Color.FromArgb(92, 47, 56);
        finish.MouseEnter += delegate { finish.ForeColor = metrics.Failure; }; finish.MouseLeave += delegate { finish.ForeColor = metrics.Muted; };
        detailTip.SetToolTip(pause, T("暂停接收新复制，已入队图片继续处理")); detailTip.SetToolTip(collapse, T("折叠状态窗")); detailTip.SetToolTip(finish, T("结束收集"));
        detailTip.ShowAlways = true; detailTip.InitialDelay = 350; detailTip.ReshowDelay = 100; detailTip.AutoPopDelay = 10000;
        Controls.AddRange(new Control[]{ statusDot, title, phase, metrics, detail, failureHint, pause, collapse, finish });
        Configure(capture, T("收录提示词"), 16, 324); capture.Top = 120;
        Configure(cancelText, T("取消"), 16, 100); cancelText.Top = 384; cancelText.TabStop = true;
        Configure(saveText, T("存入组合库"), 128, 212); saveText.Top = 384; saveText.TabStop = true;
        captureNameLabel.SetBounds(16, 156, 150, 20); captureName.SetBounds(16, 178, 150, 26); captureName.MaxLength = 200;
        captureCategoryLabel.SetBounds(182, 156, 158, 20);
        captureCategory.DropDownStyle = ComboBoxStyle.DropDownList; captureCategory.FlatStyle = FlatStyle.Flat;
        captureCategory.SetBounds(182, 178, 158, 26); captureCategory.TabStop = true;
        capturePreviewLabel.SetBounds(16, 210, 324, 20); capturePreview.SetBounds(16, 232, 324, 140);
        capturePreview.Multiline = true; capturePreview.ReadOnly = true; capturePreview.ScrollBars = ScrollBars.Vertical;
        captureStatus.SetBounds(16, 420, 324, 38); captureStatus.AutoEllipsis = true;
        Controls.AddRange(new Control[]{ capture, captureNameLabel, captureName, captureCategoryLabel, captureCategory, capturePreviewLabel, capturePreview, cancelText, saveText, captureStatus });
        foreach (var control in new Control[]{ phase, metrics, detail, capture, captureNameLabel, captureName, captureCategoryLabel, captureCategory, capturePreviewLabel, capturePreview, cancelText, saveText, captureStatus }) control.Top += 36;
        captureCategory.SelectedIndexChanged += delegate { saveText.Text = T(captureCategory.SelectedIndex > 0 ? "存入内容库" : "存入组合库"); };
        Configure(styleMode, T("风格串"), 16, 158); Configure(collectionMode, T("收藏库"), 182, 158); styleMode.Top = collectionMode.Top = 40;
        Controls.AddRange(new Control[]{ styleMode, collectionMode });
        styleMode.Click += delegate { RequestMode("style"); }; collectionMode.Click += delegate { RequestMode("collection"); };
        capture.Click += delegate { if (capturedText == "") CaptureClipboard(); else FocusCapture(); };
        cancelText.Click += delegate { EndCapture(false); };
        saveText.Click += delegate { SaveCapturedText(); };
        KeyPreview = true;
        KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Escape && capturedText != "" && !captureSaving) { e.SuppressKeyPress = true; EndCapture(false); } };
        ApplyAppearance(String.IsNullOrEmpty(initialAppearance) ? null : json.Deserialize<Dictionary<string, object>>(initialAppearance));
        pause.Click += delegate { receiving = false; Emit(new { type = paused ? "resume" : "pause", session = session }); pause.Enabled = false; };
        collapse.Click += delegate { collapsed = !collapsed; LayoutWindow(); SavePosition(); };
        finish.Click += delegate {
            if (capturedText != "" && MessageBox.Show(this, T("尚未保存的提示词将被丢弃，继续关闭？"), T("Atelier 收集"), MessageBoxButtons.OKCancel) != DialogResult.OK) return;
            Close();
        };
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
        using (var pen = new Pen(borderColor)) e.Graphics.DrawPath(pen, border);
        if (!collapsed) using (var footer = Rounded(new RectangleF(16, 126, metrics.Width, 24), 6))
            using (var brush = new SolidBrush(detail.BackColor)) e.Graphics.FillPath(brush, footer);
    }
    void Configure(Button b, string text, int x, int width) {
        b.Text = text; b.SetBounds(x, 7, width, 28); b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = 0; b.BackColor = BackColor; b.ForeColor = metrics.Muted; b.TabStop = false; b.UseVisualStyleBackColor = false;
        b.FlatAppearance.MouseOverBackColor = Color.FromArgb(45, 51, 63); b.FlatAppearance.MouseDownBackColor = Color.FromArgb(53, 60, 73);
        using (var path = Rounded(new RectangleF(0, 0, width, 28), 6)) b.Region = new Region(path);
    }
    void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    static Color Mix(Color color, Color background, double weight) { return Color.FromArgb((int)(color.R * weight + background.R * (1 - weight)), (int)(color.G * weight + background.G * (1 - weight)), (int)(color.B * weight + background.B * (1 - weight))); }
    bool ResolveDark() {
        if (themeMode != "system") return themeMode == "dark";
        if (test && testSystemDark.HasValue) return testSystemDark.Value;
        try { using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")) { var light = key == null ? null : key.GetValue("AppsUseLightTheme"); if (light != null) return Convert.ToInt32(light) == 0; } } catch { }
        return fallbackDark;
    }
    static Color PaletteColor(Dictionary<string, object> colors, string key, Color fallback) {
        string color = Str(colors, key);
        return Regex.IsMatch(color, @"^#[0-9a-fA-F]{6}$") ? ColorTranslator.FromHtml(color) : fallback;
    }
    void ApplyAppearance(Dictionary<string, object> value) {
        if (value != null) {
            if (value.ContainsKey("labels")) labels = value["labels"] as Dictionary<string, object> ?? labels;
            string mode = Str(value, "themeMode"), color = Str(value, "accentColor"), nextMotion = Str(value, "motion");
            if (mode == "light" || mode == "dark" || mode == "system") themeMode = mode;
            if (Regex.IsMatch(color, @"^#[0-9a-fA-F]{6}$")) accent = ColorTranslator.FromHtml(color);
            if (nextMotion == "full" || nextMotion == "reduced" || nextMotion == "off") motion = nextMotion;
            if (value.ContainsKey("isDark")) fallbackDark = Convert.ToBoolean(value["isDark"]);
            palette = value.ContainsKey("palette") ? value["palette"] as Dictionary<string, object> : null;
        }
        Text = T("Atelier 收集");
        metrics.Labels = new string[]{ T("待处理"), T("已保存"), T("跳过"), T("失败") };
        int metricsWidth = 324;
        foreach (string label in metrics.Labels) metricsWidth = Math.Max(metricsWidth, (TextRenderer.MeasureText(label, metrics.Font, Size.Empty, TextFormatFlags.NoPadding).Width + 27) * 4);
        metrics.Width = phase.Width = metricsWidth; detail.Width = metricsWidth - 12;
        capture.Width = capturePreviewLabel.Width = capturePreview.Width = captureStatus.Width = metricsWidth;
        captureNameLabel.Width = captureName.Width = 150;
        captureCategoryLabel.Left = captureCategory.Left = 182;
        captureCategoryLabel.Width = captureCategory.Width = metricsWidth - 166;
        styleMode.Width = collectionMode.Width = (metricsWidth - 8) / 2; collectionMode.Left = 24 + styleMode.Width;
        styleMode.Text = T("风格串"); collectionMode.Text = T("收藏库");
        saveText.Width = metricsWidth - 112;
        foreach (var button in new Button[]{ capture, cancelText, saveText, styleMode, collectionMode }) {
            using (var path = Rounded(new RectangleF(0, 0, button.Width, button.Height), 6)) { var old = button.Region; button.Region = new Region(path); if (old != null) old.Dispose(); }
        }
        capture.Text = T("收录提示词"); captureNameLabel.Text = captureName.AccessibleName = T("名称（可选）");
        captureCategoryLabel.Text = T("分类"); captureCategory.AccessibleName = T("分类");
        capturePreviewLabel.Text = capturePreview.AccessibleName = T("提示词原文");
        RefreshCategoryItems();
        saveText.Text = T(captureSaving ? "保存中…" : captureCategory.SelectedIndex > 0 ? "存入内容库" : "存入组合库"); cancelText.Text = T("取消");
        int extraWidth = metricsWidth - 324; collapse.Left = 272 + extraWidth; finish.Left = 310 + extraWidth;
        pause.Text = paused ? T("继续") : T("暂停");
        pause.Width = Math.Max(44, Math.Max(TextRenderer.MeasureText(T("暂停"), pause.Font).Width, TextRenderer.MeasureText(T("继续"), pause.Font).Width) + 12);
        pause.Left = 266 + extraWidth - pause.Width; failureHint.Left = pause.Left - 27; title.Width = failureHint.Left - 41;
        detailTip.SetToolTip(pause, paused ? T("继续接收之后的新复制") : T("暂停接收新复制，已入队图片继续处理"));
        detailTip.SetToolTip(finish, T("结束收集"));
        if (rawStage == "") { title.Text = T("正在启动"); phase.Text = T("等待本机服务确认"); }
        dark = value != null && themeMode == "system" && value.ContainsKey("isDark") ? fallbackDark : ResolveDark();
        BackColor = dark ? Color.FromArgb(23, 27, 36) : Color.White;
        ForeColor = dark ? Color.FromArgb(240, 242, 248) : Color.FromArgb(23, 30, 45);
        borderColor = dark ? Color.FromArgb(47, 54, 71) : Color.FromArgb(221, 226, 236);
        metrics.Muted = dark ? Color.FromArgb(147, 157, 181) : Color.FromArgb(111, 122, 144);
        metrics.Success = dark ? Color.FromArgb(152, 196, 172) : Color.FromArgb(44, 121, 86);
        metrics.Failure = dark ? Color.FromArgb(222, 153, 157) : Color.FromArgb(175, 65, 77);
        pausedColor = dark ? Color.FromArgb(199, 179, 133) : Color.FromArgb(145, 111, 50);
        detail.BackColor = dark ? Color.FromArgb(27, 32, 44) : Color.FromArgb(247, 248, 252);
        var modePalette = palette != null && palette.ContainsKey(dark ? "dark" : "light") ? palette[dark ? "dark" : "light"] as Dictionary<string, object> : null;
        if (modePalette != null) {
            BackColor = PaletteColor(modePalette, "panel", BackColor);
            ForeColor = PaletteColor(modePalette, "text", ForeColor);
            borderColor = PaletteColor(modePalette, "border", borderColor);
            metrics.Muted = PaletteColor(modePalette, "mutedText", metrics.Muted);
            detail.BackColor = PaletteColor(modePalette, "canvas", detail.BackColor);
        }
        title.ForeColor = metrics.ForeColor = ForeColor; phase.ForeColor = metrics.Muted;
        detail.ForeColor = latestFailed ? metrics.Failure : detail.Text.StartsWith(T("已保存：")) ? metrics.Success : metrics.Muted;
        failureHint.ForeColor = metrics.Failure;
        foreach (var button in new Button[]{ pause, collapse, finish, capture, cancelText, saveText, styleMode, collectionMode }) {
            button.BackColor = BackColor; button.ForeColor = metrics.Muted;
            button.FlatAppearance.MouseOverBackColor = Mix(accent, BackColor, dark ? 0.17 : 0.09);
            button.FlatAppearance.MouseDownBackColor = Mix(accent, BackColor, dark ? 0.25 : 0.16);
        }
        foreach (var field in new TextBox[]{ captureName, capturePreview }) { field.BackColor = detail.BackColor; field.ForeColor = ForeColor; field.BorderStyle = BorderStyle.FixedSingle; }
        captureCategory.BackColor = detail.BackColor; captureCategory.ForeColor = ForeColor;
        captureNameLabel.ForeColor = captureCategoryLabel.ForeColor = capturePreviewLabel.ForeColor = metrics.Muted; captureStatus.ForeColor = metrics.Muted;
        capture.ForeColor = ForeColor; capture.FlatAppearance.BorderSize = 1; capture.FlatAppearance.BorderColor = borderColor;
        saveText.BackColor = Mix(accent, Color.Black, 0.55); saveText.ForeColor = Color.White;
        saveText.FlatAppearance.MouseOverBackColor = Mix(accent, Color.Black, 0.62); saveText.FlatAppearance.MouseDownBackColor = Mix(accent, Color.Black, 0.48);
        PaintMode();
        finish.FlatAppearance.MouseOverBackColor = Mix(metrics.Failure, BackColor, 0.15); finish.FlatAppearance.MouseDownBackColor = Mix(metrics.Failure, BackColor, 0.24);
        statusDot.ForeColor = paused ? pausedColor : accent;
        statusDot.MotionAllowed = motion == "full"; statusDot.SetProcessing(statusDot.Processing);
        metrics.Invalidate(); Invalidate(true);
    }
    void RefreshCategoryItems() {
        string signature = T("不分类（组合库）") + "\u0001" + T("人物形象") + "\u0001" + T("服饰") + "\u0001" + T("姿势") + "\u0001" + T("表情状态") + "\u0001" + T("场景") + "\u0001" + T("镜头画面");
        if (signature == categorySignature && captureCategory.Items.Count == captureCategoryKinds.Length) return;
        categorySignature = signature;
        int index = captureCategory.SelectedIndex;
        captureCategory.BeginUpdate();
        captureCategory.Items.Clear();
        captureCategory.Items.AddRange(new object[]{ T("不分类（组合库）"), T("人物形象"), T("服饰"), T("姿势"), T("表情状态"), T("场景"), T("镜头画面") });
        captureCategory.SelectedIndex = index >= 0 && index < captureCategory.Items.Count ? index : 0;
        captureCategory.EndUpdate();
    }
    string SelectedCategory() {
        int index = captureCategory.SelectedIndex;
        return index > 0 && index < captureCategoryKinds.Length ? captureCategoryKinds[index] : "";
    }
    void Drag(object sender, MouseEventArgs e) { if (e.Button != MouseButtons.Left) return; ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); SavePosition(); }
    bool DetailIsEllipsized() {
        return detail.AutoEllipsis && detail.Text.Length > 0
            && TextRenderer.MeasureText(detail.Text, detail.Font, new Size(Int32.MaxValue, detail.ClientSize.Height), TextFormatFlags.SingleLine | TextFormatFlags.NoPadding).Width > detail.ClientSize.Width;
    }
    void LayoutWindow() {
        bool draft = capturedText != "";
        ClientSize = new Size(metrics.Width + 32, collapsed ? 43 : draft ? (captureStatus.Text != "" ? 502 : 460) : captureStatus.Text != "" ? 234 : 194);
        phase.Visible = metrics.Visible = detail.Visible = capture.Visible = !collapsed;
        styleMode.Visible = collectionMode.Visible = !collapsed;
        captureNameLabel.Visible = captureName.Visible = captureCategoryLabel.Visible = captureCategory.Visible = capturePreviewLabel.Visible = capturePreview.Visible = cancelText.Visible = saveText.Visible = !collapsed && draft;
        captureStatus.Visible = !collapsed && captureStatus.Text != ""; captureStatus.Top = draft ? 456 : 192;
        capture.Enabled = !captureSaving; saveText.Enabled = cancelText.Enabled = captureName.Enabled = captureCategory.Enabled = finish.Enabled = collapse.Enabled = !captureSaving;
        saveText.Text = T(captureSaving ? "保存中…" : captureCategory.SelectedIndex > 0 ? "存入内容库" : "存入组合库");
        title.Text = (paused ? T("已暂停") : T("收集中")) + (collapsed ? " · " + T(collectionTarget == "collection" ? "收藏库" : "风格串") + T(" · 已保存 ") + saved.ToString() : "");
        detailTip.SetToolTip(title, title.Text); failureHint.Visible = collapsed && latestFailed; detailTip.SetToolTip(failureHint, latestFailure);
        detailTip.SetToolTip(detail, !collapsed && DetailIsEllipsized() ? detail.Text : "");
        statusDot.ForeColor = paused ? pausedColor : accent;
        statusDot.SetProcessing(!paused && (rawStage == "正在下载图片" || rawStage == "正在解析图片" || rawStage == "正在保存风格串" || rawStage == "正在保存收藏"));
        collapse.Text = collapsed ? "+" : "−"; detailTip.SetToolTip(collapse, collapsed ? T("展开状态窗") : T("折叠状态窗")); UpdateCorners(); ClampPosition(); Invalidate();
    }
    void ClampPosition() {
        Rectangle area = Screen.FromRectangle(Bounds).WorkingArea;
        applyingPosition = true;
        Location = new Point(Math.Max(area.Left, Math.Min(Left, area.Right - Width)), Math.Max(area.Top, Math.Min(Top, area.Bottom - Height)));
        applyingPosition = false;
    }
    void SavePosition() { positionDirty = false; Emit(new { type = "position", session = session, x = Left, y = Top, collapsed = collapsed }); }
    uint CurrentSequence() { return test ? sequence : GetClipboardSequenceNumber(); }
    void PaintMode() {
        foreach (var button in new Button[]{ styleMode, collectionMode }) {
            bool selected = (button == collectionMode) == (collectionTarget == "collection");
            button.BackColor = selected ? Mix(accent, BackColor, 0.22) : BackColor; button.ForeColor = ForeColor;
            button.FlatAppearance.BorderSize = 1; button.FlatAppearance.BorderColor = selected ? accent : borderColor;
        }
    }
    void RequestMode(string mode) {
        if (collectionTarget == mode) return;
        receiving = false; styleMode.Enabled = collectionMode.Enabled = false;
        Emit(new { type = "mode", session = session, mode = mode });
    }
    void CandidateImage(byte[] bytes) {
        if (!receiving) return;
        if (bytes.Length > 12 * 1024 * 1024) { Emit(new { type = "capture-error", session = session, error = "图片超过存储大小上限" }); return; }
        Emit(new { type = "image", session = session, image = Convert.ToBase64String(bytes), mode = collectionTarget });
    }
    bool ReadClipboardImage() {
        try {
            uint png = RegisterClipboardFormat("PNG");
            if (IsClipboardFormatAvailable(png)) {
                if (!OpenClipboard(Handle)) { readAttempts++; return true; }
                try {
                    IntPtr memory = GetClipboardData(png); ulong size = GlobalSize(memory).ToUInt64();
                    if (size > 12 * 1024 * 1024) throw new InvalidOperationException("图片超过存储大小上限");
                    IntPtr value = GlobalLock(memory); if (value == IntPtr.Zero) throw new InvalidOperationException("剪贴板图片无法读取，请重新复制");
                    try { var bytes = new byte[(int)size]; Marshal.Copy(value, bytes, 0, bytes.Length); CandidateImage(bytes); } finally { GlobalUnlock(memory); }
                } finally { CloseClipboard(); }
            } else {
                if (!Clipboard.ContainsImage()) return false;
                using (var image = Clipboard.GetImage()) {
                    if (image == null) return false;
                    if ((long)image.Width * image.Height > 40000000) throw new InvalidOperationException("图片像素超过上限");
                    using (var stream = new MemoryStream()) { image.Save(stream, System.Drawing.Imaging.ImageFormat.Png); CandidateImage(stream.ToArray()); }
                }
            }
            sequence = CurrentSequence(); readAttempts = 0; return true;
        } catch (ExternalException) { readAttempts++; return true; }
        catch (Exception e) { sequence = CurrentSequence(); readAttempts = 0; Emit(new { type = "capture-error", session = session, error = e.Message }); return true; }
    }
    void CaptureClipboard() {
        if (test) return;
        if (!OpenClipboard(Handle)) { captureStatus.Text = T("剪贴板暂时不可用，请重试"); LayoutWindow(); return; }
        try {
            IntPtr memory = IsClipboardFormatAvailable(13) ? GetClipboardData(13) : IntPtr.Zero;
            if (memory == IntPtr.Zero) { captureStatus.Text = T("剪贴板没有文字"); return; }
            if (GlobalSize(memory).ToUInt64() > 131074) { captureStatus.Text = T("提示词过长，请分段收录"); return; }
            IntPtr value = GlobalLock(memory);
            if (value == IntPtr.Zero) { captureStatus.Text = T("剪贴板暂时不可用，请重试"); return; }
            string text;
            try { text = Marshal.PtrToStringUni(value); } finally { GlobalUnlock(memory); }
            BeginCapture(text);
        } finally { CloseClipboard(); LayoutWindow(); }
    }
    void BeginCapture(string text) {
        if (capturedText != "" || captureSaving) return;
        if (String.IsNullOrWhiteSpace(text)) { captureStatus.Text = T("剪贴板没有文字"); LayoutWindow(); return; }
        if (text.Length > 65536) { captureStatus.Text = T("提示词过长，请分段收录"); LayoutWindow(); return; }
        capturedText = text; captureId = Guid.NewGuid().ToString(); capturePreview.Text = text; captureName.Text = ""; captureStatus.Text = "";
        if (captureCategory.Items.Count > 0) captureCategory.SelectedIndex = 0;
        captureReturnFocus = GetForegroundWindow(); collapsed = false; LayoutWindow(); FocusCapture();
    }
    void FocusCapture() {
        if (test) return;
        SetWindowLong(Handle, -20, GetWindowLong(Handle, -20) & ~0x08000000);
        Activate(); captureName.Focus();
    }
    void EndCapture(bool success, string message = "") {
        capturedText = captureId = capturePreview.Text = captureName.Text = "";
        if (captureCategory.Items.Count > 0) captureCategory.SelectedIndex = 0;
        captureSaving = false; captureStatus.Text = success ? T(message != "" ? message : "已存入内容库") : "";
        SetWindowLong(Handle, -20, GetWindowLong(Handle, -20) | 0x08000000);
        if (!test && GetForegroundWindow() == Handle && captureReturnFocus != IntPtr.Zero && captureReturnFocus != Handle) SetForegroundWindow(captureReturnFocus);
        captureReturnFocus = IntPtr.Zero; LayoutWindow();
    }
    void SaveCapturedText() {
        if (capturedText == "" || captureSaving) return;
        captureSaving = true; captureStatus.Text = ""; LayoutWindow();
        Emit(new { type = "save-text", session = session, id = captureId, name = captureName.Text, text = capturedText, category = SelectedCategory() });
    }
    void ReadClipboard() {
        if (!receiving || test) return;
        if (ReadClipboardImage()) return;
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
    void Candidate(string text) { if (receiving && IsCandidate(text)) Emit(new { type = "link", session = session, url = text.Trim(), mode = collectionTarget }); }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x21 && capturedText == "") { m.Result = new IntPtr(3); return; } // 仅主动打开文字收录后允许编辑焦点。
        if (m.Msg == 0x031D && receiving) { uint now = GetClipboardSequenceNumber(); if (now != sequence) { readAttempts = 0; ReadClipboard(); } }
        if (m.Msg == 0x007E) ClampPosition(); // 显示器配置改变。
        if ((m.Msg == 0x001A || m.Msg == 0x031A) && themeMode == "system") ApplyAppearance(null); // 网页关闭后仍跟随 Windows 明暗通知。
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
                    if (!test && !AddClipboardFormatListener(Handle)) throw new Exception(T("无法注册 Windows 剪贴板变化通知"));
                    registered = !test; receiving = true;
                    SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
                    Emit(new { type = "listening", session = session });
                    if (test) ReportWindow();
                } else if (incoming != session) continue;
                else if (cmd == "pause" || cmd == "resume") {
                    paused = cmd == "pause"; receiving = !paused; sequence = CurrentSequence(); readAttempts = 0;
                    pause.Text = paused ? T("继续") : T("暂停"); pause.Enabled = true; LayoutWindow();
                    detailTip.SetToolTip(pause, paused ? T("继续接收之后的新复制") : T("暂停接收新复制，已入队图片继续处理"));
                } else if (cmd == "mode" && (Str(d, "mode") == "style" || Str(d, "mode") == "collection")) {
                    collectionTarget = Str(d, "mode"); receiving = !paused; sequence = CurrentSequence(); readAttempts = 0;
                    styleMode.Enabled = collectionMode.Enabled = true; PaintMode(); LayoutWindow(); if (test) ReportWindow();
                } else if (cmd == "stop") { receiving = false; Close(); return; }
                else if (cmd == "state") {
                    var state = d["state"] as Dictionary<string, object>;
                    if (state != null) {
                        saved = Convert.ToInt32(state["saved"]); paused = Convert.ToBoolean(state["paused"]);
                        rawStage = Str(state, "rawStage"); if (rawStage == "") rawStage = Str(state, "stage");
                        if (state.ContainsKey("appearance")) ApplyAppearance(state["appearance"] as Dictionary<string, object>);
                        phase.Text = Str(state, "stage");
                        metrics.Pending = Convert.ToInt32(state["pending"]); metrics.Saved = saved; metrics.Skipped = Convert.ToInt32(state["skipped"]); metrics.Failed = Convert.ToInt32(state["failed"]); metrics.Invalidate();
                        detailTip.SetToolTip(metrics, T("待处理 ") + metrics.Pending + T(" · 已保存 ") + saved + T(" · 跳过 ") + metrics.Skipped + T(" · 失败 ") + metrics.Failed);
                        detail.Text = Str(state, "error") != "" ? Str(state, "error") : Str(state, "detail");
                        latestFailed = detail.Text.StartsWith(T("失败：")) || Str(state, "error") != ""; latestFailure = latestFailed ? detail.Text : "";
                        detail.ForeColor = latestFailed ? metrics.Failure : detail.Text.StartsWith(T("已保存：")) ? metrics.Success : metrics.Muted;
                        if (state.ContainsKey("appearance")) ApplyAppearance(state["appearance"] as Dictionary<string, object>);
                        LayoutWindow();
                        if (test) ReportWindow();
                    }
                } else if (cmd == "text-result" && Str(d, "id") == captureId) {
                    if (d.ContainsKey("ok") && Convert.ToBoolean(d["ok"])) EndCapture(true, Str(d, "message"));
                    else { captureSaving = false; captureStatus.Text = T("保存失败，请重试"); LayoutWindow(); }
                    if (test) ReportWindow();
                } else if (test && cmd == "capture-text") { BeginCapture(Str(d, "text")); ReportWindow(); }
                else if (test && cmd == "save-text") {
                    captureName.Text = Str(d, "name");
                    if (d.ContainsKey("category")) {
                        int categoryIndex = Array.IndexOf(captureCategoryKinds, Str(d, "category"));
                        if (captureCategory.Items.Count > 0) captureCategory.SelectedIndex = categoryIndex > 0 ? categoryIndex : 0;
                    }
                    SaveCapturedText(); ReportWindow();
                }
                else if (test && cmd == "cancel-text") { EndCapture(false); ReportWindow(); }
                else if (test && cmd == "inject") { sequence++; Candidate(Str(d, "text")); }
                else if (test && cmd == "inject-image") { sequence++; CandidateImage(Convert.FromBase64String(Str(d, "image"))); }
                else if (test && cmd == "collapse") { collapse.PerformClick(); ReportWindow(); }
                else if (test && cmd == "snapshot") {
                    using (var bitmap = new Bitmap(Width, Height)) { DrawToBitmap(bitmap, new Rectangle(0, 0, Width, Height)); bitmap.Save(Str(d, "path"), System.Drawing.Imaging.ImageFormat.Png); }
                }
                else if (test && cmd == "system-theme") { testSystemDark = Convert.ToBoolean(d["dark"]); SendMessage(Handle, 0x001A, IntPtr.Zero, IntPtr.Zero); ReportWindow(); }
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
            title = title.Text, breathing = statusDot.Breathing, processing = statusDot.Processing, tooltipWhileInactive = detailTip.ShowAlways, detailTooltip = detailTip.GetToolTip(detail), failureHint = failureHint.Visible, failureTooltip = detailTip.GetToolTip(failureHint), rounded = nativeCorners || Region != null,
            counters = new { pending = metrics.Pending, saved = metrics.Saved, skipped = metrics.Skipped, failed = metrics.Failed },
            pauseTextFits = TextRenderer.MeasureText(pause.Text, pause.Font).Width <= pause.Width - 8, metricLabelsFit = metrics.LabelsFit,
            capture = new { draft = capturedText != "", saving = captureSaving, status = captureStatus.Text, visible = capture.Visible, preview = capturePreview.Text, category = SelectedCategory() }, mode = collectionTarget,
            appearance = new { themeMode = themeMode, dark = dark, accent = Hex(accent), background = Hex(BackColor), foreground = Hex(ForeColor), muted = Hex(metrics.Muted), failure = Hex(metrics.Failure), motion = motion } });
    }
    static string Hex(Color color) { return "#" + color.R.ToString("X2") + color.G.ToString("X2") + color.B.ToString("X2"); }
    [STAThread] public static void Run(bool test, string appearance) { Application.EnableVisualStyles(); Application.Run(new AtelierCollectorWindow(test, appearance)); }
}
