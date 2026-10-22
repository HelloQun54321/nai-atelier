// 收集控制器保留原剪贴板与串行协议，WPF 显示层独立维护。
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Threading;
using Clipboard = System.Windows.Forms.Clipboard;

public sealed class AtelierCollectorWindow {
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
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 64*1024*1024 };
    Dictionary<string,object> currentAppearance;
    readonly ConcurrentQueue<string> input = new ConcurrentQueue<string>();
    readonly DispatcherTimer timer = new DispatcherTimer();
    readonly AtelierCollectorView view;
    readonly CollectorViewState state = new CollectorViewState();
    readonly bool test;
    volatile bool eof;
    bool receiving, registered, positionDirty, applyingPosition;
    int readAttempts;
    string session = "", lastAppearance = "";
    uint sequence;
    DateTime positionChanged, pulse = DateTime.MinValue;
    string target { get { return state.Mode; } }
    IntPtr Handle { get { return view.NativeHandle; } }
    static string Str(Dictionary<string,object> value,string key) { return value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
    public AtelierCollectorWindow(bool selfTest,string appearance) {
        test=selfTest; view=new AtelierCollectorView(appearance); lastAppearance=appearance ?? "";
        currentAppearance=String.IsNullOrEmpty(appearance)?null:json.Deserialize<Dictionary<string,object>>(appearance);
        view.Command += delegate(string command,string value) {
            if(command=="position") { SavePosition(); return; }
            receiving=false;
            view.PendingCommand(command);
            if(command=="mode") Emit(new {type="mode",session=session,mode=value});
            else if(command=="category") Emit(new {type="category",session=session,category=value});
            else Emit(new {type=command,session=session});
        };
        view.NativeMessage += delegate(int message) { if(message==0x31D && receiving && GetClipboardSequenceNumber()!=sequence) { readAttempts=0; ReadClipboard(); } };
        view.LocationChanged += delegate { if(!applyingPosition && session!="") { positionDirty=true; positionChanged=DateTime.UtcNow; } };
        view.ContentRendered += delegate { Emit(new {type="ready"}); };
        view.Closing += delegate { if(positionDirty) SavePosition(); if(registered) { RemoveClipboardFormatListener(Handle); registered=false; } receiving=false; };
        view.Closed += delegate { timer.Stop(); Emit(new {type="stop",session=session}); };
        timer.Interval=TimeSpan.FromMilliseconds(50); timer.Tick+=Tick; timer.Start();
        Thread reader=new Thread(delegate() { try { string line; while((line=Console.ReadLine())!=null) input.Enqueue(line); } catch { } eof=true; }); reader.IsBackground=true; reader.Start();
    }
    void SavePosition() { positionDirty=false; var position=view.PhysicalPosition(); Emit(new {type="position",session=session,x=(int)Math.Round(position.X),y=(int)Math.Round(position.Y),collapsed=view.Collapsed}); }
    uint CurrentSequence() { return test ? sequence : GetClipboardSequenceNumber(); }
    void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    void CandidateImage(byte[] bytes) { if (!receiving || target == "content") return; if (bytes.Length > 12*1024*1024) { Emit(new { type = "capture-error", session = session, mode = target, error = "图片超过存储大小上限" }); return; } Emit(new { type = "image", session = session, image = Convert.ToBase64String(bytes), mode = target }); }
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
        catch (Exception e) { sequence = CurrentSequence(); readAttempts = 0; Emit(new { type = "capture-error", session = session, mode = target, error = e.Message }); return true; }
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
            if (GlobalSize(memory).ToUInt64() > (target == "content" ? 131074UL : 16386UL)) { if (target == "content") Emit(new { type = "capture-error", session = session, mode = target, error = "提示词过长，请分段收录" }); return; }
            IntPtr value = GlobalLock(memory); if (value == IntPtr.Zero) return;
            try { Candidate(Marshal.PtrToStringUni(value)); } finally { GlobalUnlock(memory); }
        } finally { CloseClipboard(); sequence = observed; readAttempts = 0; }
    }
    public static bool IsCandidate(string text) {
        if (String.IsNullOrWhiteSpace(text) || text.Length > 8192) return false; text = text.Trim(); if (Regex.IsMatch(text, @"\s")) return false;
        Uri uri; if (!Uri.TryCreate(text, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo != "") return false;
        return Regex.IsMatch(Uri.UnescapeDataString(uri.AbsolutePath), @"\.(png|jpe?g|webp|gif|avif)$", RegexOptions.IgnoreCase) || ((uri.Host == "cdn.discordapp.com" || uri.Host == "media.discordapp.net") && Regex.IsMatch(uri.AbsolutePath, @"^/attachments/\d+/\d+/"));
    }
    void Candidate(string text) { if (!receiving) return; if (target == "content") { if (!String.IsNullOrWhiteSpace(text)) Emit(new { type = "text", session = session, text = text, mode = target, category = state.Category }); } else if (IsCandidate(text)) Emit(new { type = "link", session = session, url = text.Trim(), mode = target }); }

    void Tick(object sender,EventArgs args) {
        if(eof) { view.Close(); return; }
        if(positionDirty && (DateTime.UtcNow-positionChanged).TotalMilliseconds>300) SavePosition();
        if(readAttempts>0 && readAttempts<4) ReadClipboard();
        string line;
        while(input.TryDequeue(out line)) {
            try {
                var d=json.Deserialize<Dictionary<string,object>>(line); string command=Str(d,"command"),incoming=Str(d,"session");
                if(command=="start" && session=="") {
                    session=incoming; applyingPosition=true;
                    if(d.ContainsKey("appearance")) { currentAppearance=d["appearance"] as Dictionary<string,object>; view.ApplyAppearance(currentAppearance); lastAppearance=json.Serialize(currentAppearance); }
                    view.RestorePosition(d.ContainsKey("position") ? d["position"] as Dictionary<string,object> : null); applyingPosition=false;
                    sequence=CurrentSequence();
                    if(!test && !AddClipboardFormatListener(Handle)) throw new Exception("无法注册 Windows 剪贴板变化通知");
                    registered=!test; receiving=true; Emit(new {type="listening",session=session}); if(test) ReportWindow();
                } else if(incoming!=session) continue;
                else if(command=="pause" || command=="resume") { state.Paused=command=="pause"; receiving=!state.Paused; sequence=CurrentSequence(); readAttempts=0; view.AcknowledgeCommand(); view.UpdateState(state); }
                else if(command=="mode" && Array.IndexOf(AtelierCollectorView.ModeKeys,Str(d,"mode"))>=0) { state.Mode=Str(d,"mode"); receiving=!state.Paused; sequence=CurrentSequence(); readAttempts=0; view.AcknowledgeCommand(); view.UpdateState(state); if(test) ReportWindow(); }
                else if(command=="category" && Array.IndexOf(AtelierCollectorView.Categories,Str(d,"category"))>=0) { state.Category=Str(d,"category"); receiving=!state.Paused; sequence=CurrentSequence(); readAttempts=0; view.AcknowledgeCommand(); view.UpdateState(state); if(test) ReportWindow(); }
                else if(command=="stop") { receiving=false; view.Close(); return; }
                else if(command=="state") {
                    var value=d["state"] as Dictionary<string,object>;
                    if(value!=null) {
                        state.Saved=Convert.ToInt32(value["saved"]); state.Paused=Convert.ToBoolean(value["paused"]); state.RawStage=Str(value,"rawStage"); if(state.RawStage=="") state.RawStage=Str(value,"stage");
                        state.Phase=Str(value,"stage"); state.Detail=Str(value,"error")!="" ? Str(value,"error") : Str(value,"detail");
                        state.Pending=Convert.ToInt32(value["pending"]); state.Skipped=Convert.ToInt32(value["skipped"]); state.Failed=Convert.ToInt32(value["failed"]);
                        bool changed=value.ContainsKey("appearance");
                        var a=changed ? value["appearance"] as Dictionary<string,object> : currentAppearance;
                        var labels=a!=null && a.ContainsKey("labels") ? a["labels"] as Dictionary<string,object> : null;
                        string failure=labels!=null && labels.ContainsKey("失败：") ? Convert.ToString(labels["失败："]) : "失败：";
                        state.LatestFailed=Str(value,"error")!="" || state.Detail.StartsWith(failure);
                        if(changed && a!=null) { string nextAppearance=json.Serialize(a); if(nextAppearance!=lastAppearance) { view.ApplyAppearance(a); lastAppearance=nextAppearance; currentAppearance=a; } }
                        view.UpdateState(state); if(test) ReportWindow();
                    }
                } else if(test && command=="inject") { sequence++; Candidate(Str(d,"text")); }
                else if(test && command=="inject-image") { sequence++; CandidateImage(Convert.FromBase64String(Str(d,"image"))); }
                else if(test && command=="inject-files") { sequence++; CandidateFiles(d["paths"] as System.Collections.IEnumerable); }
                else if(test && command=="collapse") { view.ToggleCollapsed(); ReportWindow(); }
                else if(test && command=="snapshot") view.Snapshot(Str(d,"path"));
                else if(test && command=="system-theme") { view.TestSystemTheme(Convert.ToBoolean(d["dark"])); ReportWindow(); }
                if(d.ContainsKey("id")) Emit(new {type="ack",session=session,id=Str(d,"id")});
            } catch(Exception e) { Emit(new {type="error",session=session,error=e.Message}); receiving=false; view.Close(); return; }
        }
        if((DateTime.UtcNow-pulse).TotalSeconds>2) { pulse=DateTime.UtcNow; Emit(new {type="pulse",session=session}); }
    }
    void ReportWindow() { Emit(view.Report(session)); }
    [STAThread] public static void Run(bool test,string appearance) { var controller=new AtelierCollectorWindow(test,appearance); new Application().Run(controller.view); }
}
