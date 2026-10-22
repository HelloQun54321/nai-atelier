// WPF 负责带 Alpha 的显示层；剪贴板与收集协议仍由独立控制器处理。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Documents;
using System.Windows.Media.Effects;
using Microsoft.Win32;

public sealed class CollectorViewState {
    public string Mode = "style", Category = "", Phase = "", Detail = "", RawStage = "";
    public bool Paused, LatestFailed;
    public int Pending, Saved, Skipped, Failed;
}

public sealed class CollectorGlassButton : Button {
    Brush fill, hover, stroke, glassBorder;
    bool hovered, glass, selected;
    double highlight, shadow, radius;
    Border face;
    public CollectorGlassReflection Reflection { get; private set; }
    public Func<Color,Color,Brush> ReadableBacking;
    public CollectorGlassButton() {
        Focusable = false; Padding = new Thickness(5,0,5,0); BorderThickness = new Thickness(1);
        var face = new FrameworkElementFactory(typeof(Border)); face.Name = "face";
        face.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        face.SetBinding(Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        face.SetBinding(Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        face.SetBinding(Border.CornerRadiusProperty, new System.Windows.Data.Binding("Tag") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center); content.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        var layers=new FrameworkElementFactory(typeof(Grid));
        var reflection=new FrameworkElementFactory(typeof(CollectorGlassReflection));reflection.Name="reflection";reflection.SetValue(UIElement.IsHitTestVisibleProperty,false);
        layers.AppendChild(reflection);layers.AppendChild(content);face.AppendChild(layers);Template = new ControlTemplate(typeof(Button)) { VisualTree = face };
        MouseEnter += delegate { hovered = true; UpdateSurface(); };
        MouseLeave += delegate { hovered = false; UpdateSurface(); };
        IsEnabledChanged += delegate { UpdateSurface(); };
        PreviewMouseLeftButtonDown += delegate { Opacity = .78; };
        PreviewMouseLeftButtonUp += delegate { Opacity = 1; };
        LostMouseCapture += delegate { Opacity = 1; };
    }
    public void Surface(Brush normal, Brush over, Brush stroke, double radius) {
        fill = normal; hover = over; this.stroke=stroke;this.radius=radius;Tag = new CornerRadius(radius);UpdateSurface();
    }
    public void Glass(bool enabled,bool active,double highlight,double shadow,Brush border) {
        glass=enabled;selected=active;this.highlight=highlight;this.shadow=shadow;glassBorder=border;UpdateSurface();
    }
    public override void OnApplyTemplate() {
        base.OnApplyTemplate();face=GetTemplateChild("face") as Border;Reflection=GetTemplateChild("reflection") as CollectorGlassReflection;UpdateSurface();
    }
    void UpdateSurface() {
        bool active=glass && IsEnabled && (selected || hovered);
        Background=hovered && IsEnabled ? hover : fill;BorderBrush=active?glassBorder:stroke;
        if(Reflection!=null) {Reflection.Control=true;Reflection.Highlight=active?highlight:0;Reflection.Shadow=active?shadow:0;Reflection.Radius=radius;Reflection.InvalidateVisual();}
        if(face!=null) face.Effect=active && selected && shadow>0 ? new DropShadowEffect {Color=Colors.Black,Opacity=shadow*.3,BlurRadius=3,ShadowDepth=1,Direction=270,RenderingBias=RenderingBias.Quality} : null;
        var caption=Content as TextBlock;
        if(caption!=null && ReadableBacking!=null && Background is SolidColorBrush && Foreground is SolidColorBrush) caption.Background=ReadableBacking(((SolidColorBrush)Foreground).Color,((SolidColorBrush)Background).Color);
    }
}

// 沿用 themeDetails.css 侧边栏的 36px 顶缘反光及上／右／下／左四边强度。
public sealed class CollectorGlassReflection : FrameworkElement {
    public double Highlight, Radius, Shadow;
    public bool Control;
    protected override void OnRender(DrawingContext dc) {
        if((Highlight<=0 && Shadow<=0) || ActualWidth<=0 || ActualHeight<=0) return;
        double w=ActualWidth,h=ActualHeight;
        dc.PushClip(new RectangleGeometry(new Rect(0,0,w,h),Radius,Radius));
        var sheen=new LinearGradientBrush {StartPoint=new Point(0,0),EndPoint=new Point(0,Control?h*.7:36),MappingMode=BrushMappingMode.Absolute};
        sheen.GradientStops.Add(new GradientStop(Color.FromArgb((byte)Math.Round(255*Highlight*(Control ? .16 : .28)),255,255,255),0));
        if(!Control) sheen.GradientStops.Add(new GradientStop(Color.FromArgb((byte)Math.Round(255*Highlight*.08),255,255,255),1.0/3));
        sheen.GradientStops.Add(new GradientStop(Colors.Transparent,1));
        dc.DrawRectangle(sheen,null,new Rect(0,0,w,Math.Min(36,h)));
        double[] strengths={Control?Highlight:Math.Min(.8,Highlight*2.5),Highlight*.2,Control?Shadow*.3:Highlight*.4,Highlight*.7};
        Matrix[] transforms={Matrix.Identity,new Matrix(0,1,-1,0,w,0),new Matrix(-1,0,0,-1,w,h),new Matrix(0,-1,1,0,0,h)};
        for(int side=0;side<4;side++) {
            double length=side%2==0 ? w : h,r=Math.Max(0,Math.Min(Radius,Math.Min(w,h)/2)-.5),diagonal=r/Math.Sqrt(2);
            var edge=new StreamGeometry();
            using(var path=edge.Open()) {
                path.BeginFigure(new Point(r+.5-diagonal,r+.5-diagonal),false,false);
                if(r>0) path.ArcTo(new Point(r+.5,.5),new Size(r,r),0,false,SweepDirection.Clockwise,true,false);
                path.LineTo(new Point(length-r-.5,.5),true,false);
                if(r>0) path.ArcTo(new Point(length-r-.5+diagonal,r+.5-diagonal),new Size(r,r),0,false,SweepDirection.Clockwise,true,false);
            }
            dc.PushTransform(new MatrixTransform(transforms[side]));
            byte tone=(byte)(Control && side==2?0:255);
            dc.DrawGeometry(null,new Pen(new SolidColorBrush(Color.FromArgb((byte)Math.Round(255*strengths[side]),tone,tone,tone)),1),edge);
            dc.Pop();
        }
        dc.Pop();
    }
}

public sealed class AtelierCollectorView : Window {
    [StructLayout(LayoutKind.Sequential)] struct WindowRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out WindowRect rect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int left,int top,int right,int bottom,int width,int height);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr window,IntPtr region,bool redraw);
    readonly Grid root = new Grid();
    readonly Canvas canvas = new Canvas { Background=Brushes.Transparent };
    readonly Border surface = new Border(), track = new Border(), detailSurface = new Border();
    readonly Image wallpaper = new Image { Stretch=Stretch.UniformToFill, IsHitTestVisible=false };
    readonly Dictionary<string,BitmapSource> wallpapers = new Dictionary<string,BitmapSource>();
    readonly Dictionary<string,string> wallpaperCodes = new Dictionary<string,string>();
    readonly Dictionary<Color,Brush> textBackings = new Dictionary<Color,Brush>();
    readonly CollectorGlassReflection reflection = new CollectorGlassReflection {IsHitTestVisible=false};
    readonly TextBlock title = Label(), phase = Label(), detail = Label(), destinationLabel = Label();
    readonly System.Windows.Shapes.Ellipse statusDot = new System.Windows.Shapes.Ellipse { Width = 8, Height = 8 };
    readonly CollectorGlassButton pause = new CollectorGlassButton(), collapse = new CollectorGlassButton(), finish = new CollectorGlassButton(), destination = new CollectorGlassButton();
    readonly CollectorGlassButton[] modes = { new CollectorGlassButton(), new CollectorGlassButton(), new CollectorGlassButton() };
    readonly Grid metrics = new Grid();
    readonly TextBlock[] metricLabels = new TextBlock[4], metricValues = new TextBlock[4];
    public static readonly string[] ModeKeys = { "style", "collection", "content" }, ModeLabels = { "风格串", "收藏库", "提示词库" };
    public static readonly string[] Categories = { "", "appearance", "wardrobe", "pose", "expression", "scene", "camera", "general" }, CategoryLabels = { "原文", "外貌", "服饰", "动作", "表情", "场景", "镜头", "通用" };
    Dictionary<string,object> appearance = new Dictionary<string,object>(), labels = new Dictionary<string,object>();
    CollectorViewState state = new CollectorViewState();
    HwndSource source;
    Color panel, text, muted, accent, border, canvasColor, backgroundMin, backgroundMax;
    bool dark, translucent, processing, breathing, closed;
    bool? testDark;
    double tintOpacity, highlight, borderOpacity, controlRadius, panelRadius, blur, saturation, refraction, controlShadow;
    int imageRevision;
    string renderedBackground;
    string windowShape;
    string themeMode = "system", motion = "full", material = "frosted";
    public bool Collapsed { get; private set; }
    public IntPtr NativeHandle { get { return source == null ? IntPtr.Zero : source.Handle; } }
    public event Action<string,string> Command;
    public event Action<int> NativeMessage;
    public double TintOpacity { get { return tintOpacity; } }
    public Brush SurfaceBrush { get { return surface.Background; } }
    public CollectorGlassReflection Reflection { get { return reflection; } }
    public CollectorGlassButton[] ModeButtons { get { return modes; } }

    public AtelierCollectorView(string initialAppearance) {
        WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize; ShowInTaskbar = false; ShowActivated = false; Topmost = true;
        Width = 384; Height = 232; FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI"); FontSize = 13;
        AllowsTransparency = true; UseLayoutRounding = true; SnapsToDevicePixels = true; Background = Brushes.Transparent;
        TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display); TextOptions.SetTextRenderingMode(this, TextRenderingMode.Grayscale);
        surface.BorderThickness = new Thickness(1);
        root.Children.Add(wallpaper); root.Children.Add(surface); root.Children.Add(reflection); root.Children.Add(canvas); Content = root;
        foreach (var element in new UIElement[]{ track, detailSurface, statusDot, title, pause, collapse, finish, destinationLabel, destination, phase, metrics, detail }) canvas.Children.Add(element);
        for (int i = 0; i < modes.Length; i++) { int index = i; canvas.Children.Add(modes[i]); modes[i].Click += delegate { Request("mode",ModeKeys[index]); }; }
        for (int i = 0; i < 4; i++) {
            metrics.ColumnDefinitions.Add(new ColumnDefinition());
            var group = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, ClipToBounds = true };
            metricLabels[i] = Label(); metricValues[i] = Label(); metricValues[i].FontWeight = FontWeights.SemiBold; metricValues[i].Margin = new Thickness(7,0,0,0);
            group.Children.Add(metricLabels[i]); group.Children.Add(metricValues[i]); Grid.SetColumn(group,i); metrics.Children.Add(group);
        }
        title.FontWeight = FontWeights.SemiBold; detail.FontSize = 12; destinationLabel.FontSize = 12;
        pause.Click += delegate { Request(state.Paused ? "resume" : "pause", ""); };
        collapse.Click += delegate { ToggleCollapsed(); };
        finish.Click += delegate { Close(); };
        destination.Click += delegate { if (state.Mode == "content") OpenCategories(); };
        canvas.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
            if (e.OriginalSource is Button || NativeHandle == IntPtr.Zero) return;
            ReleaseCapture(); SendMessage(NativeHandle,0xA1,new IntPtr(2),IntPtr.Zero); e.Handled = true;
        };
        SourceInitialized += delegate {
            source = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle); source.AddHook(WindowMessage);
            SetWindowLong(NativeHandle,-20,(GetWindowLong(NativeHandle,-20) | 0x08000000 | 0x00000080) & ~0x00040000);
            source.CompositionTarget.BackgroundColor = Colors.Transparent; Refresh();
        };
        SizeChanged += delegate { UpdateWindowShape(); };
        LocationChanged += delegate { UpdateWindowShape(); };
        IsVisibleChanged += delegate { UpdateWindowShape(); };
        ContentRendered += delegate { UpdateWindowShape(); };
        Closed += delegate { closed = true; statusDot.BeginAnimation(OpacityProperty,null); if (source != null) source.RemoveHook(WindowMessage); };
        if (!String.IsNullOrEmpty(initialAppearance)) appearance = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string,object>>(initialAppearance);
        ApplyAppearance(appearance);
    }
    static TextBlock Label() { return new TextBlock { TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center }; }
    static string Str(Dictionary<string,object> value, string key) { return value != null && value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
    static Dictionary<string,object> Map(Dictionary<string,object> value, string key) { return value != null && value.ContainsKey(key) ? value[key] as Dictionary<string,object> : null; }
    static double Number(Dictionary<string,object> value, string key, double fallback) { double result; return value != null && value.ContainsKey(key) && Double.TryParse(Convert.ToString(value[key],CultureInfo.InvariantCulture),NumberStyles.Float,CultureInfo.InvariantCulture,out result) && !Double.IsNaN(result) && !Double.IsInfinity(result) ? result : fallback; }
    static Color ColorValue(Dictionary<string,object> value, string key, string fallback) { string hex = Str(value,key); return (Color)ColorConverter.ConvertFromString(System.Text.RegularExpressions.Regex.IsMatch(hex,"^#[a-fA-F0-9]{6}$") ? hex : fallback); }
    static Brush Brush(Color color, double opacity) { return new SolidColorBrush(Color.FromArgb((byte)Math.Round(Math.Max(0,Math.Min(1,opacity))*255),color.R,color.G,color.B)); }
    static void Place(FrameworkElement element, double x, double y, double width, double height) { Canvas.SetLeft(element,x); Canvas.SetTop(element,y); element.Width = width; element.Height = height; }
    static double Measure(string value, double size) { return new FormattedText(value ?? "",CultureInfo.CurrentUICulture,FlowDirection.LeftToRight,new Typeface("Microsoft YaHei UI"),size,Brushes.Black,1).WidthIncludingTrailingWhitespace; }
    string T(string value) { return labels.ContainsKey(value) ? Convert.ToString(labels[value]) : value; }
    void Request(string command, string value) { if (Command != null) Command(command,value); }
    bool ResolveDark() {
        if (themeMode != "system") return themeMode == "dark";
        if (testDark.HasValue) return testDark.Value;
        try { using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")) { if (key != null && key.GetValue("AppsUseLightTheme") != null) return Convert.ToInt32(key.GetValue("AppsUseLightTheme")) == 0; } } catch { }
        return appearance.ContainsKey("isDark") && Convert.ToBoolean(appearance["isDark"]);
    }
    public void ApplyAppearance(Dictionary<string,object> value) {
        appearance = value ?? appearance; labels = Map(appearance,"labels") ?? new Dictionary<string,object>();
        themeMode = Str(appearance,"themeMode"); if (themeMode == "") themeMode = "system";
        dark = ResolveDark(); motion = Str(appearance,"motion"); translucent = Str(appearance,"surfaces") == "translucent";
        var palette = Map(Map(appearance,"palette"),dark ? "dark" : "light");
        var parameters = Map(Map(appearance,"materials"),dark ? "dark" : "light");
        panel = ColorValue(palette,translucent ? "sidebar" : "panel",dark ? (translucent ? "#12151c" : "#171b24") : (translucent ? "#fbfcff" : "#ffffff")); text = ColorValue(palette,"text",dark ? "#f0f2f8" : "#171e2d");
        canvasColor=ColorValue(palette,"canvas",dark?"#0d0f14":"#f3f5fa");
        muted = ColorValue(palette,"mutedText",dark ? "#939db5" : "#59677f"); border = ColorValue(palette,"border",dark ? "#5a6478" : "#b4bccf");
        accent = ColorValue(Map(appearance,"accents"),dark ? "dark" : "light",Str(appearance,"accentColor") == "" ? "#0ea5e9" : Str(appearance,"accentColor"));
        material = Str(parameters,"kind") == "glass" ? "glass" : "frosted";
        tintOpacity = Number(parameters,"opacity",.85); highlight = Number(parameters,"highlight",.3); borderOpacity = Number(parameters,"borderOpacity",.26);
        controlShadow=Number(parameters,"controlShadow",.25);
        controlRadius = Number(parameters,"controlRadius",Str(appearance,"corners") == "soft" ? 10 : Str(appearance,"corners") == "sharp" ? 3 : 7);
        panelRadius = Number(parameters,"panelRadius",8);
        blur=Number(parameters,"blur",22);saturation=Number(parameters,"saturation",130);refraction=material=="glass"?Number(parameters,"refraction",0):0;
        if (SystemParameters.HighContrast) { panel = SystemColors.WindowColor; text = SystemColors.WindowTextColor; muted = text; accent = SystemColors.HighlightColor; border = text; translucent=false; panelRadius=8; }
        Title = T("Atelier 收集"); Foreground = Brush(text,1);
        if(appearance.ContainsKey("images")) SetWallpapers(Map(appearance,"images"));
        Refresh();
    }
    public void SetWallpapers(Dictionary<string,object> images) {
        foreach(string mode in new[]{"light","dark"}) {
            string encoded=Str(images,mode),previous;
            if(wallpaperCodes.TryGetValue(mode,out previous) && previous==encoded) continue;
            wallpaperCodes[mode]=encoded;wallpapers.Remove(mode);imageRevision++;
            if(encoded=="" || encoded.Length>20000000) continue;
            try {
                using(var stream=new System.IO.MemoryStream(Convert.FromBase64String(encoded))) {
                    var image=new BitmapImage(); image.BeginInit(); image.CacheOption=BitmapCacheOption.OnLoad; image.StreamSource=stream; image.EndInit(); image.Freeze(); wallpapers[mode]=image;
                }
            } catch(Exception) { /* 无效资源回退主题实色，不影响收集。 */ }
        }
        renderedBackground=null;
    }
    void SetSurface() {
        string mode=dark?"dark":"light";
        var background=Map(Map(appearance,"backgrounds"),mode);
        BitmapSource image; wallpapers.TryGetValue(mode,out image);
        if(background==null || !translucent) image=null;
        string fit=Str(background,"fit");double opacity=Number(background,"opacity",1),tileSize=Number(background,"tileSize",128);
        double scale=source==null?1:source.CompositionTarget.TransformToDevice.M11;
        string key=Width+":"+Height+":"+scale+":"+mode+":"+translucent+":"+imageRevision+":"+fit+":"+opacity+":"+tileSize+":"+canvasColor+":"+panel+":"+tintOpacity+":"+blur+":"+saturation+":"+refraction+":"+panelRadius;
        if(key!=renderedBackground) {
            wallpaper.Source=translucent ? CollectorWallpaper.Render(image,fit,opacity,tileSize,canvasColor,Width,Height,scale,blur,saturation,refraction,panelRadius) : null;
            renderedBackground=key;
            backgroundMin=backgroundMax=panel;
            if(wallpaper.Source!=null) {
                var bitmap=(BitmapSource)wallpaper.Source;var pixels=new byte[bitmap.PixelWidth*bitmap.PixelHeight*4];bitmap.CopyPixels(pixels,bitmap.PixelWidth*4,0);
                byte[] min={255,255,255},max={0,0,0};
                for(int p=0;p<pixels.Length;p+=4)for(int c=0;c<3;c++) {min[c]=Math.Min(min[c],pixels[p+c]);max[c]=Math.Max(max[c],pixels[p+c]);}
                var tint=((SolidColorBrush)Brush(panel,tintOpacity)).Color;
                backgroundMin=Composite(tint,Color.FromRgb(min[2],min[1],min[0]));backgroundMax=Composite(tint,Color.FromRgb(max[2],max[1],max[0]));
            }
            textBackings.Clear();
        }
        // 透明度描述主题色与图片的混合；窗口自身不透出桌面。
        root.Background = Brush(canvasColor,1);
        surface.Background = Brush(panel,translucent ? tintOpacity : 1);
        surface.BorderBrush = Brush(border,translucent ? borderOpacity : .45);
        surface.CornerRadius=new CornerRadius(panelRadius);
        reflection.Highlight=translucent && material=="glass" ? highlight : 0; reflection.Radius=panelRadius; reflection.InvalidateVisual();
    }
    Brush TextBacking(Color color) {
        Brush cached;if(textBackings.TryGetValue(color,out cached))return cached;
        cached=TextBackingBetween(color,backgroundMin,backgroundMax);textBackings[color]=cached;return cached;
    }
    Brush ControlTextBacking(Color color,Color fill) {
        Color min=Composite(fill,backgroundMin),max=Composite(fill,backgroundMax);
        if(translucent && material=="glass") max=Composite(((SolidColorBrush)Brush(Colors.White,highlight*.16)).Color,max);
        return TextBackingBetween(color,min,max);
    }
    static Brush TextBackingBetween(Color color,Color min,Color max) {
        double foreground=Luminance(color);Color backing=foreground>.179?Colors.Black:Colors.White;
        for(int step=0;step<=20;step++) {
            var brush=(SolidColorBrush)Brush(backing,step/20d);
            double low=Luminance(Composite(brush.Color,min)),high=Luminance(Composite(brush.Color,max));
            double contrast=foreground<low?(low+.05)/(foreground+.05):foreground>high?(foreground+.05)/(high+.05):1;
            if(contrast>=4.5 || step==20) return brush;
        }
        return Brushes.Transparent;
    }
    void ProtectText(TextBlock label) {
        string value=label.Text;var color=((SolidColorBrush)label.Foreground).Color;
        label.Inlines.Clear();label.Inlines.Add(new Run(value) {Background=TextBacking(color)});
    }
    void UpdateWindowShape() {
        WindowRect bounds; if(NativeHandle==IntPtr.Zero || closed || !GetWindowRect(NativeHandle,out bounds)) return;
        int w=bounds.Right-bounds.Left,h=bounds.Bottom-bounds.Top,r=(int)Math.Round(panelRadius*source.CompositionTarget.TransformToDevice.M11*2);
        string shape=w+":"+h+":"+r; if(shape==windowShape || w<=0 || h<=0) return;
        // 单窗口与内容共用圆角，避免透明窗口边缘留下矩形区域。
        IntPtr region=CreateRoundRectRgn(0,0,w+1,h+1,r,r);
        if(region==IntPtr.Zero) return;
        if(SetWindowRgn(NativeHandle,region,true)==0) DeleteObject(region); else windowShape=shape;
    }
    public void UpdateState(CollectorViewState value) { state = value; Refresh(); }
    public void PendingCommand(string command) { if(command=="mode") foreach(var button in modes) button.IsEnabled=false; if(command=="pause" || command=="resume") pause.IsEnabled=false; }
    public void AcknowledgeCommand() { foreach(var button in modes) button.IsEnabled=true; pause.IsEnabled=true; }
    public void ToggleCollapsed() { Collapsed = !Collapsed; Refresh(); Request("position",""); }
    public void TestSystemTheme(bool value) { testDark = value; ApplyAppearance(appearance); }
    void Refresh() {
        Width = 384;
        foreach (string label in ModeLabels) Width = Math.Max(Width,(Measure(T(label),FontSize)+28)*3+30);
        foreach (string label in new string[]{"待处理","已保存","跳过","失败"}) Width = Math.Max(Width,(Measure(T(label),FontSize)+32)*4+32);
        Height = Collapsed ? 44 : 232;
        root.Clip = new RectangleGeometry(new Rect(0,0,Width,Height),panelRadius,panelRadius);
        SetSurface();
        Place(statusDot,18,18,8,8); Place(title,34,10,Width-200,24);
        Place(pause,Width-144,8,64,28); Place(collapse,Width-74,8,28,28); Place(finish,Width-40,8,28,28);
        pause.Content = T(state.Paused ? "继续" : "暂停"); collapse.Content = Collapsed ? "+" : "−"; finish.Content = "×";
        title.Text = T(state.Paused ? "已暂停" : "收集中") + (Collapsed ? " · " + T(ModeLabels[Array.IndexOf(ModeKeys,state.Mode)]) : "");
        ToolTipService.SetToolTip(title,title.Text + T(" · 已保存 ") + state.Saved + (state.LatestFailed ? " · " + state.Detail : "")); ToolTipService.SetShowOnDisabled(title,true);
        ToolTipService.SetToolTip(pause,T(state.Paused ? "继续接收之后的新复制" : "暂停接收新复制，已入队内容继续处理"));
        ToolTipService.SetToolTip(collapse,T(Collapsed ? "展开状态窗" : "折叠状态窗")); ToolTipService.SetToolTip(finish,T("结束收集"));
        bool glass=translucent && material=="glass";
        foreach (var button in new CollectorGlassButton[]{ pause,collapse,finish,destination,modes[0],modes[1],modes[2] }) {
            button.Foreground = Brush(text,1); button.FontSize = FontSize;button.ReadableBacking=ControlTextBacking;
            button.Surface(Brushes.Transparent,Brush(glass?panel:text,glass?borderOpacity*.5:dark?.09:.055),Brushes.Transparent,controlRadius);
            button.Glass(glass,false,highlight,controlShadow,Brush(border,borderOpacity));
        }
        finish.Surface(Brushes.Transparent,Brush(Colors.IndianRed,.16),Brushes.Transparent,controlRadius);
        Place(track,12,44,Width-24,38); track.CornerRadius = new CornerRadius(controlRadius+3); track.Background = Brush(text,translucent ? 0 : .06);
        track.BorderThickness=new Thickness(glass?1:0);track.BorderBrush=Brush(border,glass?borderOpacity*.5:0);
        double tabWidth = (Width-30)/3;
        for (int i=0;i<modes.Length;i++) {
            bool selected = state.Mode == ModeKeys[i]; var button = modes[i]; button.Content = T(ModeLabels[i]); Place(button,15+tabWidth*i,47,tabWidth,32);
            Color selectedAccent = accent;
            for(int step=0;step<12 && (1.05/(Luminance(selectedAccent)+.05))<4.5;step++) selectedAccent=Color.FromRgb((byte)(selectedAccent.R*.9),(byte)(selectedAccent.G*.9),(byte)(selectedAccent.B*.9));
            Brush selectedFill = glass?Brush(accent,tintOpacity):Brush(selectedAccent,1);
            button.Surface(selected ? selectedFill : Brushes.Transparent,selected ? selectedFill : Brush(glass?panel:text,glass?borderOpacity*.5:.055),Brushes.Transparent,controlRadius);
            button.Glass(glass,selected,highlight,controlShadow,Brush(border,borderOpacity));
            button.Foreground = selected && !glass ? Brushes.White : Brush(text,1);
            button.FontWeight = selected ? FontWeights.SemiBold : FontWeights.Normal; AutomationProperties.SetName(button,T(ModeLabels[i]) + (selected ? " · " + T("已选中") : ""));
        }
        destinationLabel.Text = T("存入"); destinationLabel.Foreground = Brush(muted,1); Place(destinationLabel,16,96,54,24);
        string location = state.Mode == "content" ? CategoryLabels[Array.IndexOf(Categories,state.Category)] : state.Mode == "collection" ? "未整理" : "风格串";
        destination.Content = T(location) + (state.Mode == "content" ? "   ▾" : ""); destination.IsEnabled = state.Mode == "content"; Place(destination,76,92,Width-92,32);
        if (destination.IsEnabled) destination.Surface(Brush(text,translucent ? 0 : .025),Brush(text,.07),Brush(border,translucent ? borderOpacity*.5 : .45),controlRadius);
        phase.Text = state.Phase; phase.Foreground = Brush(muted,1); Place(phase,16,133,Width-32,21);
        Place(metrics,16,160,Width-32,23); string[] names = {"待处理","已保存","跳过","失败"}; int[] values = {state.Pending,state.Saved,state.Skipped,state.Failed};
        for(int i=0;i<4;i++) { metricLabels[i].Text = T(names[i]); metricLabels[i].Foreground = Brush(muted,1); metricValues[i].Text = values[i].ToString(); metricValues[i].Width=Math.Max(16,metrics.Width/4-Measure(metricLabels[i].Text,FontSize)-10); metricValues[i].Foreground = Brush(i==1 && values[i]>0 ? (dark ? Colors.LightGreen : Color.FromRgb(44,121,86)) : i==3 && values[i]>0 ? (dark ? Colors.LightCoral : Color.FromRgb(175,65,77)) : text,1); }
        Place(detailSurface,12,192,Width-24,28); detailSurface.CornerRadius = new CornerRadius(7); detailSurface.Background = Brush(text,translucent ? 0 : .035);
        detail.Text = state.Detail; detail.Foreground = Brush(state.LatestFailed ? (dark ? Colors.LightCoral : Color.FromRgb(175,65,77)) : muted,1); Place(detail,24,197,Width-48,19);
        ToolTipService.SetToolTip(detail,Measure(state.Detail,detail.FontSize)>detail.Width ? state.Detail : null);
        foreach(var element in new UIElement[]{track,modes[0],modes[1],modes[2],destinationLabel,destination,phase,metrics,detailSurface,detail}) element.Visibility = Collapsed ? Visibility.Collapsed : Visibility.Visible;
        statusDot.Fill = Brush(state.LatestFailed && Collapsed ? (dark ? Colors.LightCoral : Color.FromRgb(175,65,77)) : state.Paused ? muted : accent,1);
        processing = !state.Paused && (state.RawStage == "正在下载图片" || state.RawStage == "正在解析图片" || state.RawStage == "正在保存风格串" || state.RawStage == "正在保存收藏" || state.RawStage == "正在收录提示词");
        bool next = processing && motion == "full" && SystemParameters.ClientAreaAnimation;
        if (next != breathing) { breathing = next; statusDot.BeginAnimation(OpacityProperty,next ? new DoubleAnimation(.5,1,new Duration(TimeSpan.FromSeconds(1.2))) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever } : null); }
        title.Foreground=Brush(text,1);
        foreach(var label in new[]{title,phase,detail,destinationLabel}) ProtectText(label);
        foreach(var label in metricLabels) ProtectText(label);
        foreach(var label in metricValues) ProtectText(label);
        foreach(var button in new[]{pause,collapse,finish,destination,modes[0],modes[1],modes[2]}) {
            string caption=button.Content is TextBlock?((TextBlock)button.Content).Text:Convert.ToString(button.Content);
            var fill=(SolidColorBrush)button.Background;
            button.Content=new TextBlock {Text=caption,Background=ControlTextBacking(((SolidColorBrush)button.Foreground).Color,fill.Color)};
        }
        if (NativeHandle != IntPtr.Zero && !closed) { UpdateWindowShape(); ClampPosition(); }
    }
    static double Luminance(Color color) { Func<byte,double> channel = v => v/255.0 <= .04045 ? v/255.0/12.92 : Math.Pow((v/255.0+.055)/1.055,2.4); return .2126*channel(color.R)+.7152*channel(color.G)+.0722*channel(color.B); }
    void OpenCategories() {
        var menu = new ContextMenu { PlacementTarget = destination, Placement = PlacementMode.Bottom, Background = Brush(panel,1), Foreground = Brush(text,1), FontFamily = FontFamily, FontSize = FontSize, BorderBrush = Brush(border,.5), BorderThickness = new Thickness(1), StaysOpen = false };
        var menuFrame=new FrameworkElementFactory(typeof(Border)); menuFrame.SetValue(Border.CornerRadiusProperty,new CornerRadius(panelRadius)); menuFrame.SetValue(Border.BackgroundProperty,Brush(panel,1)); menuFrame.SetValue(Border.BorderBrushProperty,Brush(border,.45)); menuFrame.SetValue(Border.BorderThicknessProperty,new Thickness(1)); menuFrame.SetValue(Border.PaddingProperty,new Thickness(4)); menuFrame.AppendChild(new FrameworkElementFactory(typeof(ItemsPresenter))); menu.Template=new ControlTemplate(typeof(ContextMenu)){VisualTree=menuFrame};
        for(int i=0;i<Categories.Length;i++) {
            int index=i; var header=new StackPanel {Orientation=Orientation.Horizontal}; header.Children.Add(new TextBlock {Text=Categories[i]==state.Category ? "✓" : "",Width=22}); header.Children.Add(new TextBlock {Text=T(CategoryLabels[i])});
            var item=new MenuItem {Header=header,IsCheckable=true,IsChecked=Categories[i]==state.Category,Background=Brushes.Transparent};
            var face=new FrameworkElementFactory(typeof(Border)); face.Name="face"; face.SetValue(Border.CornerRadiusProperty,new CornerRadius(controlRadius)); face.SetValue(Border.PaddingProperty,new Thickness(10,7,14,7));
            var content=new FrameworkElementFactory(typeof(ContentPresenter)); content.SetValue(ContentPresenter.ContentSourceProperty,"Header"); face.AppendChild(content);
            var template=new ControlTemplate(typeof(MenuItem)){VisualTree=face}; var over=new Trigger{Property=MenuItem.IsHighlightedProperty,Value=true}; over.Setters.Add(new Setter(Border.BackgroundProperty,Brush(text,.075),"face")); template.Triggers.Add(over); item.Template=template;
            item.Click+=delegate { Request("category",Categories[index]); }; menu.Items.Add(item);
        }
        menu.IsOpen = true;
    }
    IntPtr WindowMessage(IntPtr hwnd,int message,IntPtr wParam,IntPtr lParam,ref bool handled) {
        if (message==0x21) { handled=true; return new IntPtr(3); }
        if (message==0x1A || message==0x31A || message==0x31E) ApplyAppearance(appearance);
        if (message==0x7E || message==0x2E0) Dispatcher.BeginInvoke(new Action(delegate { renderedBackground=null;Refresh(); }));
        if (message==0x47) UpdateWindowShape();
        if (NativeMessage!=null) NativeMessage(message); return IntPtr.Zero;
    }
    public void RestorePosition(Dictionary<string,object> value) {
        if(value!=null && value.ContainsKey("x") && value.ContainsKey("y")) {
            Collapsed=value.ContainsKey("collapsed") && Convert.ToBoolean(value["collapsed"]);
            Refresh(); SetWindowPos(NativeHandle,IntPtr.Zero,Convert.ToInt32(value["x"]),Convert.ToInt32(value["y"]),0,0,0x0001|0x0004|0x0010);
        } else { var area=SystemParameters.WorkArea; Left=area.Right-Width-24; Top=area.Top+24; }
        Refresh(); ClampPosition();
    }
    public Point PhysicalPosition() { WindowRect bounds; return NativeHandle!=IntPtr.Zero && GetWindowRect(NativeHandle,out bounds) ? new Point(bounds.Left,bounds.Top) : new Point(0,0); }
    public void ClampPosition() {
        WindowRect bounds; if(NativeHandle==IntPtr.Zero || !GetWindowRect(NativeHandle,out bounds)) return;
        var screen=System.Windows.Forms.Screen.FromHandle(NativeHandle).WorkingArea;
        int x=Math.Max(screen.Left,Math.Min(bounds.Left,screen.Right-(bounds.Right-bounds.Left))), y=Math.Max(screen.Top,Math.Min(bounds.Top,screen.Bottom-(bounds.Bottom-bounds.Top)));
        if(x!=bounds.Left || y!=bounds.Top) SetWindowPos(NativeHandle,IntPtr.Zero,x,y,0,0,0x0001|0x0004|0x0010);
    }
    bool PositionVisible() { WindowRect bounds; return NativeHandle!=IntPtr.Zero && GetWindowRect(NativeHandle,out bounds) && System.Windows.Forms.Screen.FromHandle(NativeHandle).WorkingArea.Contains(System.Drawing.Rectangle.FromLTRB(bounds.Left,bounds.Top,bounds.Right,bounds.Bottom)); }
    public object Report(string session) {
        bool fit=true; for(int i=0;i<3;i++) fit &= Measure(T(ModeLabels[i]),FontSize)<=modes[i].Width-12;
        for(int i=0;i<4;i++) fit &= Measure(metricLabels[i].Text,FontSize)+Measure(metricValues[i].Text,FontSize)+7 <= metrics.Width/4;
        var selected=modes[Array.IndexOf(ModeKeys,state.Mode)]; var selectedFill=((SolidColorBrush)selected.Background).Color;
        Color under=Composite(((SolidColorBrush)track.Background).Color,panel); Color selectedColor=Composite(selectedFill,under);
        return new { type="window",session=session,noActivate=NativeHandle==IntPtr.Zero || (GetWindowLong(NativeHandle,-20)&0x08000000)!=0,topMost=Topmost,foreground=NativeHandle!=IntPtr.Zero && GetForegroundWindow()==NativeHandle,
            visiblePosition=PositionVisible(),collapsed=Collapsed,width=Width,height=Height,mode=state.Mode,category=state.Category,title=title.Text,phase=phase.Text,detail=detail.Text,detailVisible=!Collapsed,detailTooltip=ToolTipService.GetToolTip(detail) ?? "",titleTooltip=ToolTipService.GetToolTip(title),
            breathing=breathing,processing=processing,tooltipWhileInactive=true,rounded=true,labelsFit=fit,editableFields=0,counters=new {pending=state.Pending,saved=state.Saved,skipped=state.Skipped,failed=state.Failed},
            appearance=new {themeMode=themeMode,dark=dark,accent=Hex(accent),background=Hex(panel),foreground=Hex(text),muted=Hex(muted),surfaces=translucent?"translucent":"solid",radius=panelRadius,selectedFill=Hex(selectedColor),selectedText=Hex(((SolidColorBrush)selected.Foreground).Color),motion=motion,material=material,tintOpacity=tintOpacity,blur=blur,saturation=saturation,refraction=refraction,controlRadius=controlRadius,textBacking=((SolidColorBrush)TextBacking(text)).Color.ToString(),mutedBacking=((SolidColorBrush)TextBacking(muted)).Color.ToString(),renderer=translucent?"theme-image":"solid",wallpaper=translucent && wallpapers.ContainsKey(dark?"dark":"light") ? (dark?"dark":"light") : ""} };
    }
    static Color Composite(Color color,Color under) { double a=color.A/255.0; return Color.FromRgb((byte)(color.R*a+under.R*(1-a)),(byte)(color.G*a+under.G*(1-a)),(byte)(color.B*a+under.B*(1-a))); }
    static string Hex(Color color) { return "#"+color.R.ToString("X2")+color.G.ToString("X2")+color.B.ToString("X2"); }
    public void Snapshot(string path) { root.Measure(new Size(Width,Height)); root.Arrange(new Rect(0,0,Width,Height)); root.UpdateLayout(); var bitmap=new RenderTargetBitmap((int)Width,(int)Height,96,96,PixelFormats.Pbgra32); bitmap.Render(root); var png=new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(bitmap)); using(var file=System.IO.File.Create(path)) png.Save(file); }
}
