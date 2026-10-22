// 只创建未显示的 WPF 视图并在内存合成像素；不创建顶层窗口句柄或访问剪贴板。
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

public static class CollectorViewRegression {
    static void Check(bool value,string message) { if(!value) throw new Exception(message); }
    static double Luminance(string hex) {
        Color c=(Color)ColorConverter.ConvertFromString(hex);
        Func<byte,double> f=v => v/255.0<=.04045 ? v/255.0/12.92 : Math.Pow((v/255.0+.055)/1.055,2.4);
        return .2126*f(c.R)+.7152*f(c.G)+.0722*f(c.B);
    }
    static byte[] Render(AtelierCollectorView view,double scale) {
        var root=(Grid)view.Content; root.Measure(new Size(view.Width,view.Height)); root.Arrange(new Rect(0,0,view.Width,view.Height)); root.UpdateLayout();
        var bitmap=new RenderTargetBitmap((int)Math.Ceiling(view.Width*scale),(int)Math.Ceiling(view.Height*scale),96*scale,96*scale,PixelFormats.Pbgra32);
        bitmap.Render(root); byte[] pixel=new byte[4]; bitmap.CopyPixels(new Int32Rect((int)(375*scale),(int)(130*scale),1,1),pixel,4,0); return pixel;
    }
    static void CheckReflection(AtelierCollectorView view,double highlight) {
        var layer=view.Reflection; int w=(int)Math.Ceiling(layer.ActualWidth),h=(int)Math.Ceiling(layer.ActualHeight);
        var bitmap=new RenderTargetBitmap(w,h,96,96,PixelFormats.Pbgra32); bitmap.Render(layer);
        Func<int,int,int> alpha=(x,y)=> { byte[] pixel=new byte[4]; bitmap.CopyPixels(new Int32Rect(x,y,1,1),pixel,4,0); return pixel[3]; };
        Check(Math.Abs(alpha(0,h/2)-Math.Round(255*highlight*.7))<=2,"left rim must match sidebar highlight*.7");
        Check(Math.Abs(alpha(w-2,h/2)+alpha(w-1,h/2)-Math.Round(255*highlight*.2))<=2,"right rim must match sidebar highlight*.2");
        Check(Math.Abs(alpha(w/2,h-2)+alpha(w/2,h-1)-Math.Round(255*highlight*.4))<=2,"bottom rim must match sidebar highlight*.4");
        double top=Math.Min(.8,highlight*2.5);
        Check(Math.Abs(alpha(w/2,0)-255*(top+highlight*.28*(1-top)))<=3,"top rim must match sidebar capped highlight*2.5");
        Check(alpha(w/2,12)>0 && alpha(w/2,36)==0 && alpha(w/2,60)==0,"surface sheen must end at 36px without a full-panel gradient");
    }
    public static void Run(string data) {
        var json=new JavaScriptSerializer(); var values=json.Deserialize<object[]>(data);
        var view=new AtelierCollectorView("");
        foreach(var item in values) {
            var appearance=(Dictionary<string,object>)item; bool glass=(string)appearance["surfaces"]=="translucent";
            view.ApplyAppearance(appearance);
            Check(!view.IsVisible && view.NativeHandle==IntPtr.Zero,"test must not open a native window");
            Check(((SolidColorBrush)view.SurfaceBrush).Color.A==255,"unavailable DWM must keep an opaque fallback");
            view.SetSurface(true);
            Check(((SolidColorBrush)view.SurfaceBrush).Color.A==(glass ? (byte)Math.Round(view.TintOpacity*255) : 255),"glass tint alpha must reach the actual surface");
            var parameters=glass ? (Dictionary<string,object>)((Dictionary<string,object>)appearance["materials"])[(bool)appearance["isDark"] ? "dark" : "light"] : null;
            Check(view.Reflection.Highlight==(glass ? Convert.ToDouble(parameters["highlight"]) : 0),"glass edge must use the current light/dark material");
            if(glass) {
                var palette=(Dictionary<string,object>)((Dictionary<string,object>)appearance["palette"])[(bool)appearance["isDark"] ? "dark" : "light"];
                Check(((SolidColorBrush)view.SurfaceBrush).Color.ToString().Substring(3)==((string)palette["sidebar"]).Substring(1).ToUpperInvariant(),"native tint must use the sidebar color, not panel color");
                Check(view.Reflection.Radius==Convert.ToDouble(parameters["panelRadius"]),"outer radius must follow sidebar geometry");
            }
            view.PendingCommand("mode"); view.ApplyAppearance(appearance);
            Check(!view.ModeButtons[0].IsEnabled,"appearance updates must not re-enable a pending mode change"); view.AcknowledgeCommand();
            view.SetSurface(true);
            foreach(string mode in AtelierCollectorView.ModeKeys) {
                var state=new CollectorViewState { Mode=mode,Phase="",Detail="",Saved=1 };
                view.UpdateState(state);
                Check(view.Width>=384 && view.Height==232,"mode changes must not expand the collector height");
                var report=json.Deserialize<Dictionary<string,object>>(json.Serialize(view.Report("synthetic")));
                Check((bool)report["labelsFit"],"translated labels must fit");
                var colors=(Dictionary<string,object>)report["appearance"];
                double a=Luminance((string)colors["selectedFill"]),b=Luminance((string)colors["selectedText"]);
                Check((Math.Max(a,b)+.05)/(Math.Min(a,b)+.05)>=4.5,"selected text contrast must be readable");
                for(int i=0;i<view.ModeButtons.Length;i++) {
                    var button=view.ModeButtons[i];
                    if(AtelierCollectorView.ModeKeys[i]!=mode) Check(((SolidColorBrush)button.Background).Color.A==0,"neutral mode controls must not stack solid panels");
                    button.IsEnabled=false; button.IsEnabled=true;
                }
                foreach(double scale in new double[]{1,1.25,1.5,2}) {
                    byte[] pixel=Render(view,scale); Check(glass ? pixel[3]>0 && pixel[3]<255 : pixel[3]==255,"rendered glass must retain alpha at every test scale");
                    Check(pixel[0]<=pixel[3] && pixel[1]<=pixel[3] && pixel[2]<=pixel[3],"rendered pixels must stay premultiplied");
                }
                if(glass) { CheckReflection(view,Convert.ToDouble(parameters["highlight"])); Check(((SolidColorBrush)view.ModeButtons[Array.IndexOf(AtelierCollectorView.ModeKeys,mode)].Background).Color.A==36,"selected mode must use sidebar 14% accent tint"); }
            }
            view.ToggleCollapsed(); Check(view.Height==44,"collapsed height"); view.ToggleCollapsed(); Check(view.Height==232,"restored height");
            if(glass) {
                var changed=json.Deserialize<Dictionary<string,object>>(json.Serialize(appearance));
                var live=(Dictionary<string,object>)((Dictionary<string,object>)changed["materials"])[(bool)appearance["isDark"] ? "dark" : "light"];
                live["opacity"]=.73; live["highlight"]=0; live["borderOpacity"]=0; live["controlRadius"]=2; live["panelRadius"]=3;
                live["blur"]=0;live["saturation"]=180;live["refraction"]=24;
                view.ApplyAppearance(changed); view.SetSurface(true); Render(view,1);
                Check(((SolidColorBrush)view.SurfaceBrush).Color.A==186 && view.Reflection.Highlight==0 && view.Reflection.Radius==3,"live material settings must replace previous values");
                Check(((CornerRadius)view.ModeButtons[0].Tag).TopLeft==2,"live corner settings must reach controls");
                var report=json.Deserialize<Dictionary<string,object>>(json.Serialize(view.Report("synthetic")));
                var actual=(Dictionary<string,object>)report["appearance"];
                Check(Convert.ToInt32(actual["blur"])==0 && Convert.ToInt32(actual["saturation"])==180 && Convert.ToInt32(actual["refraction"])==24,"shared settings must reach the native view before any window is opened");
                Check(Convert.ToInt32(((Dictionary<string,object>)report["counters"])["saved"])==1,"appearance changes must preserve collection state");
                view.ApplyAppearance(appearance);
            }
            view.SetSurface(false); Check(((SolidColorBrush)view.SurfaceBrush).Color.A==255,"switching back to solid must clear glass");
            Check(!view.IsVisible && view.NativeHandle==IntPtr.Zero,"rendering must not create native window handles");
        }
        view.Close(); CheckController(); Console.WriteLine("collector material passed without opening windows: "+values.Length);
    }
    static void CheckController() {
        var type=typeof(AtelierCollectorWindow); var flags=BindingFlags.Instance|BindingFlags.NonPublic;
        var controller=new AtelierCollectorWindow(true,"");
        var view=(AtelierCollectorView)type.GetField("view",flags).GetValue(controller);
        var eof=type.GetField("eof",flags);
        for(int i=0;i<1000 && !(bool)eof.GetValue(controller);i++) System.Threading.Thread.Sleep(1);
        Check((bool)eof.GetValue(controller),"synthetic input must be exhausted before protocol checks");
        eof.SetValue(controller,false); type.GetField("receiving",flags).SetValue(controller,true); type.GetField("session",flags).SetValue(controller,"synthetic");
        var queue=(System.Collections.Concurrent.ConcurrentQueue<string>)type.GetField("input",flags).GetValue(controller);
        string original="  {snow}, 1.2::blue hair::\r\n[smile]  ";
        var json=new JavaScriptSerializer();
        queue.Enqueue(json.Serialize(new {command="mode",session="synthetic",mode="content"}));
        queue.Enqueue(json.Serialize(new {command="category",session="synthetic",category="appearance"}));
        queue.Enqueue(json.Serialize(new {command="inject",session="synthetic",text=original}));
        queue.Enqueue(json.Serialize(new {command="pause",session="synthetic"}));
        queue.Enqueue(json.Serialize(new {command="inject",session="synthetic",text="ignored"}));
        queue.Enqueue(json.Serialize(new {command="resume",session="synthetic"}));
        queue.Enqueue(json.Serialize(new {command="mode",session="synthetic",mode="collection"}));
        queue.Enqueue(json.Serialize(new {command="inject-image",session="synthetic",image="AQID"}));
        queue.Enqueue(json.Serialize(new {command="inject-files",session="synthetic",paths=new string[]{@"C:\synthetic\desktop.PNG",@"C:\synthetic\not-image.txt"}}));
        var output=new System.IO.StringWriter(); var previous=Console.Out;
        try { Console.SetOut(output); type.GetMethod("Tick",flags).Invoke(controller,new object[]{null,EventArgs.Empty}); view.Close(); } finally { Console.SetOut(previous); }
        int texts=0,images=0,files=0;
        foreach(string line in output.ToString().Split(new char[]{'\n'},StringSplitOptions.RemoveEmptyEntries)) {
            var e=json.Deserialize<Dictionary<string,object>>(line);
            Check((string)e["type"]!="error","native controller protocol must not fail");
            if((string)e["type"]=="text") { texts++; Check((string)e["text"]==original && (string)e["category"]=="appearance","text must remain exact with its chosen category"); }
            if((string)e["type"]=="image") { images++; Check((string)e["mode"]=="collection","image mode"); }
            if((string)e["type"]=="file") { files++; Check((string)e["mode"]=="collection","desktop image mode"); }
        }
        Check(texts==1 && images==1 && files==1,"pause, mode and file filtering must retain their intake semantics");
        Check(view.NativeHandle==IntPtr.Zero,"controller tests must never create a native window");
    }
}
