// 三种收集目标共用固定小窗；仅当前模式接收新复制，后台不激活窗口。
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

// 自绘原生按钮，圆角、边线和选中态一起绘制，避免裁切系统方框造成缺边。
public sealed class CollectorButton : Button {
    public Color Fill, HoverFill, Stroke;
    public int Radius = 8;
    bool hovered;
    public CollectorButton() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent; FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; UseVisualStyleBackColor = false;
        MouseEnter += delegate { hovered = true; Invalidate(); }; MouseLeave += delegate { hovered = false; Invalidate(); };
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = AtelierCollectorWindow.Rounded(new RectangleF(.5f, .5f, Width - 1, Height - 1), Radius)) {
            using (var fill = new SolidBrush(hovered && Enabled ? HoverFill : Fill)) e.Graphics.FillPath(fill, path);
            if (Stroke.A > 0) using (var border = new Pen(Stroke)) e.Graphics.DrawPath(border, path);
        }
        TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, ForeColor, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -4, -4));
    }
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
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 20 * 1024 * 1024 };
    readonly ConcurrentQueue<string> input = new ConcurrentQueue<string>();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly ToolTip tips = new ToolTip();
    readonly CollectorStatusDot statusDot = new CollectorStatusDot();
    readonly CollectorMetrics metrics = new CollectorMetrics();
    readonly Label title = new Label(), phase = new Label(), detail = new Label(), destinationLabel = new Label();
    readonly CollectorButton pause = new CollectorButton(), collapse = new CollectorButton(), finish = new CollectorButton(), destination = new CollectorButton();
    readonly CollectorButton[] modes = { new CollectorButton(), new CollectorButton(), new CollectorButton() };
    readonly string[] modeKeys = { "style", "collection", "content" }, modeLabels = { "风格串", "收藏库", "内容库" };
    readonly string[] categories = { "", "appearance", "wardrobe", "pose", "expression", "scene", "camera" };
    readonly string[] categoryLabels = { "组合库", "人物形象", "服饰", "姿势", "表情状态", "场景", "镜头画面" };
    Dictionary<string, object> labels = new Dictionary<string, object>(), palette, accents;
    string themeMode = "system", motion = "full", surfaces = "solid", corners = "standard", rawStage = "", target = "style", category = "", session = "";
    Color accent, baseAccent = Color.FromArgb(14, 165, 233), border, track, detailFill;
    bool dark = true, fallbackDark = true, receiving, registered, paused, collapsed, nativeCorners, latestFailed, positionDirty, applyingPosition;
    readonly bool test;
    bool? testSystemDark;
    volatile bool eof;
    int readAttempts, saved, windowWidth = 384, radius = 16;
    uint sequence;
    DateTime positionChanged, pulse = DateTime.MinValue;
    string T(string value) { return labels.ContainsKey(value) ? Convert.ToString(labels[value]) : value; }
    static string Str(Dictionary<string, object> d, string key) { return d.ContainsKey(key) ? Convert.ToString(d[key]) : ""; }
    public AtelierCollectorWindow(bool selfTest, string initialAppearance) {
        test = selfTest; FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
        Font = new Font("Microsoft YaHei UI", 9); ClientSize = new Size(windowWidth, 232);
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        title.Font = new Font(Font, FontStyle.Bold); title.AutoEllipsis = phase.AutoEllipsis = detail.AutoEllipsis = true;
        title.Text = T("正在启动"); phase.Text = T("等待本机服务确认");
        Controls.AddRange(new Control[]{ statusDot, title, pause, collapse, finish, destinationLabel, destination, phase, metrics, detail });
        for (int i = 0; i < modes.Length; i++) { int index = i; Controls.Add(modes[i]); modes[i].Click += delegate { RequestMode(modeKeys[index]); }; }
        pause.Click += delegate { receiving = false; pause.Enabled = false; Emit(new { type = paused ? "resume" : "pause", session = session }); };
        collapse.Click += delegate { collapsed = !collapsed; LayoutWindow(); SavePosition(); };
        finish.Click += delegate { Close(); };
        destination.Click += delegate { if (target == "content") OpenCategories(); };
        tips.ShowAlways = true; tips.InitialDelay = 350; tips.ReshowDelay = 100; tips.AutoPopDelay = 10000;
        foreach (var control in new Control[]{ this, statusDot, title, phase, metrics, detail, destinationLabel }) control.MouseDown += Drag;
        LocationChanged += delegate { if (!applyingPosition && session != "") { positionDirty = true; positionChanged = DateTime.UtcNow; } };
        FormClosed += delegate { if (positionDirty) SavePosition(); if (registered) RemoveClipboardFormatListener(Handle); receiving = false; Emit(new { type = "stop", session = session }); };
        Shown += delegate { Emit(new { type = "ready" }); };
        ApplyAppearance(String.IsNullOrEmpty(initialAppearance) ? null : json.Deserialize<Dictionary<string, object>>(initialAppearance));
        timer.Interval = 50; timer.Tick += Tick; timer.Start();
        Thread reader = new Thread(delegate() { try { string line; while ((line = Console.ReadLine()) != null) input.Enqueue(line); } catch { } eof = true; }); reader.IsBackground = true; reader.Start();
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000080; p.ClassStyle |= 0x00020000; return p; } }
    public static GraphicsPath Rounded(RectangleF r, float radius) {
        var path = new GraphicsPath(); float d = Math.Max(1, Math.Min(radius * 2, Math.Min(r.Width, r.Height)));
        path.AddArc(r.Left, r.Top, d, d, 180, 90); path.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); path.AddArc(r.Left, r.Bottom - d, d, d, 90, 90); path.CloseFigure(); return path;
    }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        try { int corner = 2; nativeCorners = DwmSetWindowAttribute(Handle, 33, ref corner, 4) == 0; } catch (DllNotFoundException) { }
        UpdateCorners();
    }
    void UpdateCorners() { if (!nativeCorners) using (var path = Rounded(new RectangleF(0, 0, Width, Height), radius)) { var old = Region; Region = new Region(path); if (old != null) old.Dispose(); } }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Rounded(new RectangleF(.5f, .5f, Width - 1, Height - 1), radius)) using (var pen = new Pen(border)) e.Graphics.DrawPath(pen, path);
        if (!collapsed) {
            using (var path = Rounded(new RectangleF(12, 44, Width - 24, 38), corners == "soft" ? 13 : 10)) using (var fill = new SolidBrush(track)) e.Graphics.FillPath(fill, path);
            using (var path = Rounded(new RectangleF(12, 192, Width - 24, 28), 8)) using (var fill = new SolidBrush(detailFill)) e.Graphics.FillPath(fill, path);
        }
    }
    static Color Mix(Color a, Color b, double w) { return Color.FromArgb((int)(a.R*w+b.R*(1-w)), (int)(a.G*w+b.G*(1-w)), (int)(a.B*w+b.B*(1-w))); }
    static Color PaletteColor(Dictionary<string, object> p, string key, Color fallback) { string value = p == null ? "" : Str(p, key); return Regex.IsMatch(value, @"^#[a-fA-F0-9]{6}$") ? ColorTranslator.FromHtml(value) : fallback; }
    bool ResolveDark() {
        if (themeMode != "system") return themeMode == "dark";
        if (test && testSystemDark.HasValue) return testSystemDark.Value;
        try { using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")) { var light = key == null ? null : key.GetValue("AppsUseLightTheme"); if (light != null) return Convert.ToInt32(light) == 0; } } catch { }
        return fallbackDark;
    }
    void ApplyAppearance(Dictionary<string, object> value) {
        if (value != null) {
            if (value.ContainsKey("labels")) labels = value["labels"] as Dictionary<string, object> ?? labels;
            string mode = Str(value, "themeMode"); if (mode == "light" || mode == "dark" || mode == "system") themeMode = mode;
            baseAccent = PaletteColor(value, "accentColor", baseAccent); motion = Str(value, "motion");
            if (value.ContainsKey("isDark")) fallbackDark = Convert.ToBoolean(value["isDark"]);
            surfaces = Str(value, "surfaces") == "translucent" ? "translucent" : "solid"; corners = Str(value, "corners");
            palette = value.ContainsKey("palette") ? value["palette"] as Dictionary<string, object> : null;
            accents = value.ContainsKey("accents") ? value["accents"] as Dictionary<string, object> : null;
        }
        dark = value != null && themeMode == "system" && value.ContainsKey("isDark") ? fallbackDark : ResolveDark();
        accent = PaletteColor(accents, dark ? "dark" : "light", baseAccent);
        var p = palette != null && palette.ContainsKey(dark ? "dark" : "light") ? palette[dark ? "dark" : "light"] as Dictionary<string, object> : null;
        BackColor = PaletteColor(p, "panel", dark ? Color.FromArgb(23,27,36) : Color.White);
        ForeColor = PaletteColor(p, "text", dark ? Color.FromArgb(240,242,248) : Color.FromArgb(23,30,45));
        metrics.Muted = PaletteColor(p, "mutedText", dark ? Color.FromArgb(147,157,181) : Color.FromArgb(111,122,144));
        border = Mix(PaletteColor(p, "border", dark ? Color.FromArgb(90,100,120) : Color.FromArgb(180,188,207)), BackColor, surfaces == "translucent" ? .25 : .5);
        track = Mix(ForeColor, BackColor, dark ? .10 : .055); detailFill = Mix(ForeColor, BackColor, dark ? .055 : .025);
        metrics.ForeColor = ForeColor; metrics.Success = dark ? Color.FromArgb(152,196,172) : Color.FromArgb(44,121,86); metrics.Failure = dark ? Color.FromArgb(244,166,166) : Color.FromArgb(175,65,77);
        title.ForeColor = ForeColor; phase.ForeColor = destinationLabel.ForeColor = metrics.Muted;
        detail.BackColor = detailFill; detail.ForeColor = latestFailed ? metrics.Failure : metrics.Muted;
        radius = corners == "soft" ? 18 : corners == "sharp" ? 8 : 16;
        Text = T("Atelier 收集"); metrics.Labels = new string[]{ T("待处理"), T("已保存"), T("跳过"), T("失败") };
        windowWidth = 384;
        foreach (var label in metrics.Labels) windowWidth = Math.Max(windowWidth, (TextRenderer.MeasureText(label, Font, Size.Empty, TextFormatFlags.NoPadding).Width + 30) * 4 + 32);
        foreach (var label in modeLabels) windowWidth = Math.Max(windowWidth, (TextRenderer.MeasureText(T(label), Font).Width + 24) * 3 + 30);
        foreach (var button in new CollectorButton[]{ pause, collapse, finish, destination, modes[0], modes[1], modes[2] }) {
            button.Font = Font; button.Fill = BackColor; button.HoverFill = Mix(accent, BackColor, dark ? .18 : .08); button.ForeColor = ForeColor; button.Stroke = Color.Transparent;
            button.Radius = corners == "soft" ? 10 : corners == "sharp" ? 3 : 7;
        }
        finish.HoverFill = Mix(metrics.Failure, BackColor, .16);
        destination.Fill = Mix(ForeColor, BackColor, surfaces == "translucent" ? .05 : .025); destination.Stroke = surfaces == "translucent" ? Color.Transparent : border;
        statusDot.MotionAllowed = motion == "full"; LayoutWindow();
    }
    void LayoutWindow() {
        ClientSize = new Size(windowWidth, collapsed ? 44 : 232);
        statusDot.SetBounds(16, 16, 12, 12); title.SetBounds(34, 10, windowWidth - 200, 24);
        pause.Text = T(paused ? "继续" : "暂停"); pause.SetBounds(windowWidth - 144, 8, 64, 28);
        collapse.Text = collapsed ? "+" : "−"; collapse.SetBounds(windowWidth - 74, 8, 28, 28); finish.Text = "×"; finish.SetBounds(windowWidth - 40, 8, 28, 28);
        title.Text = T(paused ? "已暂停" : "收集中") + (collapsed ? " · " + T(modeLabels[Array.IndexOf(modeKeys, target)]) : "");
        tips.SetToolTip(title, title.Text + T(" · 已保存 ") + saved + (latestFailed ? " · " + detail.Text : ""));
        tips.SetToolTip(pause, T(paused ? "继续接收之后的新复制" : "暂停接收新复制，已入队内容继续处理")); tips.SetToolTip(finish, T("结束收集")); tips.SetToolTip(collapse, T(collapsed ? "展开状态窗" : "折叠状态窗"));
        int tabWidth = (windowWidth - 30) / 3;
        for (int i = 0; i < modes.Length; i++) {
            var button = modes[i]; bool selected = target == modeKeys[i]; button.Text = T(modeLabels[i]);
            button.SetBounds(15 + tabWidth*i, 47, tabWidth, 32); button.Visible = !collapsed;
            button.Fill = selected ? surfaces == "translucent" ? Mix(BackColor, Color.White, dark ? .86 : 0) : Mix(accent, Color.Black, .58) : track;
            button.ForeColor = selected && surfaces != "translucent" ? Color.White : ForeColor;
            button.HoverFill = selected ? button.Fill : Mix(accent, track, .10);
            button.Stroke = selected && surfaces == "translucent" ? border : Color.Transparent;
            button.AccessibleName = button.Text + (selected ? " · " + T("已选中") : ""); button.Invalidate();
        }
        destinationLabel.Text = T("存入"); destinationLabel.SetBounds(16, 99, 54, 22);
        string location = target == "content" ? categoryLabels[Array.IndexOf(categories, category)] : target == "collection" ? "未整理" : "风格串";
        destination.Text = T(location) + (target == "content" ? "   ▾" : ""); destination.AccessibleName = T("存入") + " " + T(location);
        destination.SetBounds(76, 92, windowWidth - 92, 32); destination.Enabled = target == "content";
        phase.SetBounds(16, 133, windowWidth - 32, 21); metrics.SetBounds(16, 160, windowWidth - 32, 23); detail.SetBounds(24, 197, windowWidth - 48, 19);
        foreach (var control in new Control[]{ destinationLabel, destination, phase, metrics, detail }) control.Visible = !collapsed;
        tips.SetToolTip(detail, DetailIsEllipsized() ? detail.Text : "");
        statusDot.ForeColor = latestFailed && collapsed ? metrics.Failure : paused ? metrics.Muted : accent;
        statusDot.SetProcessing(!paused && (rawStage == "正在下载图片" || rawStage == "正在解析图片" || rawStage == "正在保存风格串" || rawStage == "正在保存收藏" || rawStage == "正在收录提示词"));
        metrics.Invalidate(); UpdateCorners(); ClampPosition(); Invalidate(true);
    }
    bool DetailIsEllipsized() { return detail.Text.Length > 0 && TextRenderer.MeasureText(detail.Text, detail.Font, Size.Empty, TextFormatFlags.NoPadding).Width > detail.Width; }
    void OpenCategories() {
        var menu = new ContextMenuStrip { ShowImageMargin = false, ShowCheckMargin = true, BackColor = BackColor, ForeColor = ForeColor, Font = Font, Renderer = new ToolStripProfessionalRenderer(new CollectorMenuColors(BackColor, track, border)) };
        for (int i = 0; i < categories.Length; i++) { int index = i; var item = new ToolStripMenuItem(T(categoryLabels[i])) { Checked = categories[i] == category, ForeColor = ForeColor }; item.Click += delegate { receiving = false; Emit(new { type = "category", session = session, category = categories[index] }); }; menu.Items.Add(item); }
        menu.Closed += delegate { menu.Dispose(); }; menu.Show(destination, new Point(0, destination.Height));
    }
    void RequestMode(string mode) { if (target == mode) return; receiving = false; foreach (var button in modes) button.Enabled = false; Emit(new { type = "mode", session = session, mode = mode }); }
    void Drag(object sender, MouseEventArgs e) { if (e.Button != MouseButtons.Left) return; ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); SavePosition(); }
    void ClampPosition() { Rectangle area = Screen.FromRectangle(Bounds).WorkingArea; applyingPosition = true; Location = new Point(Math.Max(area.Left, Math.Min(Left, area.Right - Width)), Math.Max(area.Top, Math.Min(Top, area.Bottom - Height))); applyingPosition = false; }
    void SavePosition() { positionDirty = false; Emit(new { type = "position", session = session, x = Left, y = Top, collapsed = collapsed }); }
    uint CurrentSequence() { return test ? sequence : GetClipboardSequenceNumber(); }
    void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    void CandidateImage(byte[] bytes) { if (!receiving || target == "content") return; if (bytes.Length > 12*1024*1024) { Emit(new { type = "capture-error", session = session, error = "图片超过存储大小上限" }); return; } Emit(new { type = "image", session = session, image = Convert.ToBase64String(bytes), mode = target }); }
    void CandidateFiles(System.Collections.IEnumerable paths) { if (!receiving || target == "content") return; foreach (object value in paths) { string path = value as string; if (!String.IsNullOrEmpty(path) && Path.IsPathRooted(path) && Regex.IsMatch(path, @"\.(png|jpe?g|webp)$", RegexOptions.IgnoreCase)) Emit(new { type = "file", session = session, path = path, mode = target }); } }
    bool ReadClipboardImage() {
        try {
            if (Clipboard.ContainsFileDropList()) { CandidateFiles(Clipboard.GetFileDropList()); sequence = CurrentSequence(); readAttempts = 0; return true; }
            uint png = RegisterClipboardFormat("PNG");
            if (IsClipboardFormatAvailable(png)) {
                if (!OpenClipboard(Handle)) { readAttempts++; return true; }
                try {
                    IntPtr memory = GetClipboardData(png); ulong size = GlobalSize(memory).ToUInt64(); if (size > 12*1024*1024) throw new InvalidOperationException("图片超过存储大小上限");
                    IntPtr value = GlobalLock(memory); if (value == IntPtr.Zero) throw new InvalidOperationException("剪贴板图片无法读取，请重新复制");
                    try { var bytes = new byte[(int)size]; Marshal.Copy(value, bytes, 0, bytes.Length); CandidateImage(bytes); } finally { GlobalUnlock(memory); }
                } finally { CloseClipboard(); }
            } else {
                if (!Clipboard.ContainsImage()) return false;
                using (var image = Clipboard.GetImage()) { if (image == null) return false; if ((long)image.Width*image.Height > 40000000) throw new InvalidOperationException("图片像素超过上限"); using (var stream = new MemoryStream()) { image.Save(stream, System.Drawing.Imaging.ImageFormat.Png); CandidateImage(stream.ToArray()); } }
            }
            sequence = CurrentSequence(); readAttempts = 0; return true;
        } catch (ExternalException) { readAttempts++; return true; }
        catch (Exception e) { sequence = CurrentSequence(); readAttempts = 0; Emit(new { type = "capture-error", session = session, error = e.Message }); return true; }
    }
    void ReadClipboard() {
        if (!receiving || test) return;
        if (target != "content" && ReadClipboardImage()) return;
        if (!OpenClipboard(Handle)) { readAttempts++; return; }
        uint observed = GetClipboardSequenceNumber();
        try {
            if (IsClipboardFormatAvailable(15) || IsClipboardFormatAvailable(2) || IsClipboardFormatAvailable(8) || IsClipboardFormatAvailable(17) || IsClipboardFormatAvailable(RegisterClipboardFormat("PNG"))) return;
            if (!IsClipboardFormatAvailable(13)) return;
            IntPtr memory = GetClipboardData(13); if (memory == IntPtr.Zero) return;
            if (GlobalSize(memory).ToUInt64() > (target == "content" ? 131074UL : 16386UL)) { if (target == "content") Emit(new { type = "capture-error", session = session, error = "提示词过长，请分段收录" }); return; }
            IntPtr value = GlobalLock(memory); if (value == IntPtr.Zero) return;
            try { Candidate(Marshal.PtrToStringUni(value)); } finally { GlobalUnlock(memory); }
        } finally { CloseClipboard(); sequence = observed; readAttempts = 0; }
    }
    public static bool IsCandidate(string text) {
        if (String.IsNullOrWhiteSpace(text) || text.Length > 8192) return false; text = text.Trim(); if (Regex.IsMatch(text, @"\s")) return false;
        Uri uri; if (!Uri.TryCreate(text, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo != "") return false;
        return Regex.IsMatch(Uri.UnescapeDataString(uri.AbsolutePath), @"\.(png|jpe?g|webp|gif|avif)$", RegexOptions.IgnoreCase) || ((uri.Host == "cdn.discordapp.com" || uri.Host == "media.discordapp.net") && Regex.IsMatch(uri.AbsolutePath, @"^/attachments/\d+/\d+/"));
    }
    void Candidate(string text) { if (!receiving) return; if (target == "content") { if (!String.IsNullOrWhiteSpace(text)) Emit(new { type = "text", session = session, text = text, mode = target, category = category }); } else if (IsCandidate(text)) Emit(new { type = "link", session = session, url = text.Trim(), mode = target }); }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x21) { m.Result = new IntPtr(3); return; }
        if (m.Msg == 0x031D && receiving && GetClipboardSequenceNumber() != sequence) { readAttempts = 0; ReadClipboard(); }
        if (m.Msg == 0x007E) ClampPosition(); if ((m.Msg == 0x001A || m.Msg == 0x031A) && themeMode == "system") ApplyAppearance(null);
        base.WndProc(ref m);
    }
    void Tick(object sender, EventArgs args) {
        if (eof) { Close(); return; }
        if (positionDirty && (DateTime.UtcNow-positionChanged).TotalMilliseconds > 300) SavePosition();
        if (readAttempts > 0 && readAttempts < 4) ReadClipboard();
        string line;
        while (input.TryDequeue(out line)) {
            try {
                var d = json.Deserialize<Dictionary<string, object>>(line); string cmd = Str(d,"command"), incoming = Str(d,"session");
                if (cmd == "start" && session == "") {
                    session = incoming; applyingPosition = true;
                    var pos = d.ContainsKey("position") ? d["position"] as Dictionary<string, object> : null;
                    if (pos != null && pos.ContainsKey("x") && pos.ContainsKey("y")) { Location = new Point(Convert.ToInt32(pos["x"]),Convert.ToInt32(pos["y"])); collapsed = pos.ContainsKey("collapsed") && Convert.ToBoolean(pos["collapsed"]); }
                    else { var area = Screen.PrimaryScreen.WorkingArea; Location = new Point(area.Right-Width-24,area.Top+24); }
                    applyingPosition = false; LayoutWindow(); sequence = CurrentSequence();
                    if (!test && !AddClipboardFormatListener(Handle)) throw new Exception(T("无法注册 Windows 剪贴板变化通知"));
                    registered = !test; receiving = true; SetWindowPos(Handle,new IntPtr(-1),0,0,0,0,0x0001|0x0002|0x0010); Emit(new { type = "listening", session = session });
                    if (test) ReportWindow();
                } else if (incoming != session) continue;
                else if (cmd == "pause" || cmd == "resume") { paused = cmd == "pause"; receiving = !paused; sequence = CurrentSequence(); readAttempts = 0; pause.Enabled = true; LayoutWindow(); }
                else if (cmd == "mode" && Array.IndexOf(modeKeys,Str(d,"mode")) >= 0) { target = Str(d,"mode"); receiving = !paused; sequence = CurrentSequence(); readAttempts = 0; foreach (var b in modes) b.Enabled = true; LayoutWindow(); if (test) ReportWindow(); }
                else if (cmd == "category" && Array.IndexOf(categories,Str(d,"category")) >= 0) { category = Str(d,"category"); receiving = !paused; sequence = CurrentSequence(); readAttempts = 0; LayoutWindow(); if (test) ReportWindow(); }
                else if (cmd == "stop") { receiving = false; Close(); return; }
                else if (cmd == "state") {
                    var state = d["state"] as Dictionary<string,object>; if (state != null) {
                        saved = Convert.ToInt32(state["saved"]); paused = Convert.ToBoolean(state["paused"]); rawStage = Str(state,"rawStage"); if (rawStage == "") rawStage = Str(state,"stage");
                        phase.Text = Str(state,"stage"); detail.Text = Str(state,"error") != "" ? Str(state,"error") : Str(state,"detail");
                        var stateAppearance = state.ContainsKey("appearance") ? state["appearance"] as Dictionary<string,object> : null;
                        if (stateAppearance != null && stateAppearance.ContainsKey("labels")) labels = stateAppearance["labels"] as Dictionary<string,object> ?? labels;
                        latestFailed = detail.Text.StartsWith(T("失败：")) || Str(state,"error") != "";
                        metrics.Pending = Convert.ToInt32(state["pending"]); metrics.Saved = saved; metrics.Skipped = Convert.ToInt32(state["skipped"]); metrics.Failed = Convert.ToInt32(state["failed"]);
                        if (stateAppearance != null) ApplyAppearance(stateAppearance); else { detail.ForeColor = latestFailed ? metrics.Failure : metrics.Muted; LayoutWindow(); }
                        if (test) ReportWindow();
                    }
                } else if (test && cmd == "inject") { sequence++; Candidate(Str(d,"text")); }
                else if (test && cmd == "inject-image") { sequence++; CandidateImage(Convert.FromBase64String(Str(d,"image"))); }
                else if (test && cmd == "inject-files") { sequence++; CandidateFiles(d["paths"] as System.Collections.IEnumerable); }
                else if (test && cmd == "collapse") { collapse.PerformClick(); ReportWindow(); }
                else if (test && cmd == "snapshot") { using (var bitmap = new Bitmap(Width,Height)) { DrawToBitmap(bitmap,new Rectangle(0,0,Width,Height)); bitmap.Save(Str(d,"path"),System.Drawing.Imaging.ImageFormat.Png); } }
                else if (test && cmd == "system-theme") { testSystemDark = Convert.ToBoolean(d["dark"]); SendMessage(Handle,0x001A,IntPtr.Zero,IntPtr.Zero); ReportWindow(); }
                if (d.ContainsKey("id")) Emit(new { type = "ack", session = session, id = Str(d,"id") });
            } catch (Exception e) { Emit(new { type = "error", session = session, error = e.Message }); receiving = false; Close(); return; }
        }
        if ((DateTime.UtcNow-pulse).TotalSeconds > 2) { pulse = DateTime.UtcNow; Emit(new { type = "pulse", session = session }); }
    }
    void ReportWindow() {
        bool labelsFit = metrics.LabelsFit; foreach (var b in modes) labelsFit &= TextRenderer.MeasureText(b.Text,b.Font).Width <= b.Width-12;
        Emit(new { type = "window", session = session, noActivate = (GetWindowLong(Handle,-20)&0x08000000)!=0, topMost = TopMost, foreground = GetForegroundWindow()==Handle,
            visiblePosition = Screen.FromRectangle(Bounds).WorkingArea.Contains(Bounds), collapsed = collapsed, width = Width, height = Height, mode = target, category = category,
            title = title.Text, phase = phase.Text, detail = detail.Text, detailVisible = detail.Visible, detailTooltip = tips.GetToolTip(detail), titleTooltip = tips.GetToolTip(title),
            breathing = statusDot.Breathing, processing = statusDot.Processing, tooltipWhileInactive = tips.ShowAlways, rounded = nativeCorners || Region != null,
            labelsFit = labelsFit, editableFields = 0, counters = new { pending = metrics.Pending, saved = metrics.Saved, skipped = metrics.Skipped, failed = metrics.Failed },
            appearance = new { themeMode = themeMode, dark = dark, accent = Hex(accent), background = Hex(BackColor), foreground = Hex(ForeColor), muted = Hex(metrics.Muted), surfaces = surfaces, radius = radius, selectedFill = Hex(modes[Array.IndexOf(modeKeys,target)].Fill), selectedText = Hex(modes[Array.IndexOf(modeKeys,target)].ForeColor), motion = motion } });
    }
    static string Hex(Color c) { return "#"+c.R.ToString("X2")+c.G.ToString("X2")+c.B.ToString("X2"); }
    [STAThread] public static void Run(bool test, string appearance) { Application.EnableVisualStyles(); Application.Run(new AtelierCollectorWindow(test,appearance)); }
}

public sealed class CollectorMenuColors : ProfessionalColorTable {
    readonly Color background, selected, border;
    public CollectorMenuColors(Color background, Color selected, Color border) { this.background=background; this.selected=selected; this.border=border; UseSystemColors=false; }
    public override Color ToolStripDropDownBackground { get { return background; } }
    public override Color MenuItemSelected { get { return selected; } }
    public override Color MenuBorder { get { return border; } }
    public override Color MenuItemBorder { get { return border; } }
}
