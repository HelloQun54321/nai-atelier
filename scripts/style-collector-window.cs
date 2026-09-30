// Windows 消息驱动的剪贴板监听与不激活置顶窗；普通文本在此进程内直接丢弃。
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

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
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly ConcurrentQueue<string> input = new ConcurrentQueue<string>();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Label title = new Label(), phase = new Label(), counts = new Label();
    readonly Button pause = new Button(), collapse = new Button(), finish = new Button();
    readonly bool test;
    volatile bool eof;
    bool receiving, registered, collapsed, applyingPosition, paused;
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
        BackColor = Color.FromArgb(27, 31, 39); ForeColor = Color.FromArgb(226, 230, 236);
        Font = new Font("Microsoft YaHei UI", 9); ClientSize = new Size(356, 98);
        title.SetBounds(12, 10, 183, 24); phase.SetBounds(12, 37, 332, 22); counts.SetBounds(12, 65, 332, 22);
        title.Text = "● 正在启动收集"; phase.Text = "等待本机服务确认";
        Configure(pause, "暂停", 200, 49); Configure(collapse, "−", 255, 38); Configure(finish, "×", 300, 38);
        Controls.AddRange(new Control[]{ title, phase, counts, pause, collapse, finish });
        pause.Click += delegate { receiving = false; Emit(new { type = paused ? "resume" : "pause", session = session }); pause.Enabled = false; };
        collapse.Click += delegate { collapsed = !collapsed; LayoutWindow(); SavePosition(); };
        finish.Click += delegate { Close(); };
        MouseDown += Drag; title.MouseDown += Drag; phase.MouseDown += Drag; counts.MouseDown += Drag;
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
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000080; return p; } }
    void Configure(Button b, string text, int x, int width) {
        b.Text = text; b.SetBounds(x, 7, width, 28); b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = 0; b.BackColor = Color.FromArgb(44, 50, 62); b.ForeColor = ForeColor; b.TabStop = false;
    }
    void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    void Drag(object sender, MouseEventArgs e) { if (e.Button != MouseButtons.Left) return; ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); SavePosition(); }
    void LayoutWindow() {
        ClientSize = new Size(356, collapsed ? 43 : 98); phase.Visible = counts.Visible = !collapsed;
        title.Text = "● " + (paused ? "已暂停" : "风格串收集中") + (collapsed ? " · " + saved.ToString() : "");
        collapse.Text = collapsed ? "+" : "−"; ClampPosition();
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
                } else if (cmd == "stop") { receiving = false; Close(); return; }
                else if (cmd == "state") {
                    var state = d["state"] as Dictionary<string, object>;
                    if (state != null) {
                        saved = Convert.ToInt32(state["saved"]); paused = Convert.ToBoolean(state["paused"]);
                        phase.Text = Str(state, "stage") + " · 待处理 " + Str(state, "pending");
                        counts.Text = "已保存 " + saved.ToString() + " · 跳过 " + Str(state, "skipped") + " · 失败 " + Str(state, "failed");
                        LayoutWindow();
                    }
                } else if (test && cmd == "inject") { sequence++; Candidate(Str(d, "text")); }
                else if (test && cmd == "collapse") { collapse.PerformClick(); ReportWindow(); }
                if (d.ContainsKey("id")) Emit(new { type = "ack", session = session, id = Str(d, "id") });
            } catch (Exception e) { Emit(new { type = "error", session = session, error = e.Message }); receiving = false; Close(); return; }
        }
        if ((DateTime.UtcNow - pulse).TotalSeconds > 2) { pulse = DateTime.UtcNow; Emit(new { type = "pulse", session = session }); }
    }
    void ReportWindow() {
        Rectangle area = Screen.FromRectangle(Bounds).WorkingArea;
        Emit(new { type = "window", session = session, noActivate = (GetWindowLong(Handle, -20) & 0x08000000) != 0,
            topMost = (GetWindowLong(Handle, -20) & 8) != 0, foreground = GetForegroundWindow() == Handle,
            visiblePosition = area.Contains(Bounds), collapsed = collapsed, height = Height });
    }
    [STAThread] public static void Run(bool test) { Application.EnableVisualStyles(); Application.Run(new AtelierCollectorWindow(test)); }
}
