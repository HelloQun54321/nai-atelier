// 只创建隐藏句柄，验证单窗口生命周期与控制命令，不访问剪贴板或桌面。
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Input;

public static class CollectorWallpaperWindow {
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    static void Check(bool value,string message) { if(!value)throw new Exception(message); }
    static byte[] Pixels(BitmapSource image) { var bytes=new byte[image.PixelWidth*image.PixelHeight*4];image.CopyPixels(bytes,image.PixelWidth*4,0);return bytes; }
    static bool Same(byte[] a,byte[] b) { if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true; }
    static byte[] ButtonPixels(CollectorGlassButton button) {
        button.Measure(new Size(120,32));button.Arrange(new Rect(0,0,120,32));button.UpdateLayout();
        var bitmap=new RenderTargetBitmap(120,32,96,96,PixelFormats.Pbgra32);bitmap.Render(button);return Pixels(bitmap);
    }
    static void CheckControls() {
        var button=new CollectorGlassButton {Width=120,Height=32,Content="test",Foreground=Brushes.White};
        var fill=new SolidColorBrush(Color.FromArgb(97,10,132,255));
        button.Surface(Brushes.Transparent,new SolidColorBrush(Color.FromArgb(30,230,240,255)),Brushes.Transparent,12);
        button.Glass(true,false,.4,.2,Brushes.Transparent);
        var idle=ButtonPixels(button);Check(button.Reflection.Highlight==0,"neutral glass controls must stay quiet at rest");
        button.RaiseEvent(new MouseEventArgs(Mouse.PrimaryDevice,0){RoutedEvent=Mouse.MouseEnterEvent});
        Check(!Same(idle,ButtonPixels(button)) && button.Reflection.Highlight==.4,"hover must paint theme-driven reflection pixels");
        button.IsEnabled=false;Check(button.Reflection.Highlight==0,"disabled controls must not retain hover light");button.IsEnabled=true;
        button.RaiseEvent(new MouseEventArgs(Mouse.PrimaryDevice,0){RoutedEvent=Mouse.MouseLeaveEvent});
        Check(Same(idle,ButtonPixels(button)),"pointer leave must restore the neutral surface");
        button.Surface(fill,fill,Brushes.Transparent,24);button.Glass(true,true,.7,.6,Brushes.Transparent);
        var raised=ButtonPixels(button);
        Check(button.Reflection.Highlight==.7 && button.Reflection.Shadow==.6 && button.Reflection.Radius==24,"selected slider must follow highlight, shadow and radius without a separate preset");
        Check(((SolidColorBrush)button.Background).Color.A==97,"reflection must not thicken the selected tint");
        button.Glass(true,true,0,0,Brushes.Transparent);
        Check(!Same(raised,ButtonPixels(button)),"zero highlight and shadow must remove raised optics");
        button.Glass(false,true,.7,.6,Brushes.Transparent);ButtonPixels(button);
        Check(button.Reflection.Highlight==0 && button.Reflection.Shadow==0,"solid theme must clear all glass control optics");
    }
    static void CheckEffects() {
        var bytes=new byte[64*32*4];
        for(int y=0;y<32;y++)for(int x=0;x<64;x++) {int p=(y*64+x)*4;bytes[p]=(byte)(60+x*2);bytes[p+1]=(byte)(40+y*4);bytes[p+2]=(byte)(x%8<4?80:160);bytes[p+3]=255;}
        var image=BitmapSource.Create(64,32,96,96,PixelFormats.Pbgra32,null,bytes,64*4);
        Func<string,double,double,double,double,double,BitmapSource> render=(fit,opacity,blur,saturation,refraction,scale)=>CollectorWallpaper.Render(image,fit,opacity,16,Colors.Gray,64,64,scale,blur,saturation,refraction,16);
        var original=Pixels(render("cover",1,0,100,0,1));
        Check(!Same(original,Pixels(render("cover",1,8,100,0,1))),"blur must change actual image pixels");
        Check(!Same(original,Pixels(render("cover",1,0,180,0,1))),"saturation must change actual image pixels");
        var refracted=Pixels(render("cover",1,0,100,24,1));Check(!Same(original,refracted),"refraction must change edge pixels");
        for(int y=20;y<44;y++)for(int x=20;x<44;x++)for(int c=0;c<4;c++)Check(original[(y*64+x)*4+c]==refracted[(y*64+x)*4+c],"refraction must preserve central image pixels");
        var hidden=Pixels(render("cover",0,0,100,0,1));for(int p=0;p<hidden.Length;p+=4)Check(hidden[p]==128 && hidden[p+1]==128 && hidden[p+2]==128 && hidden[p+3]==255,"zero background opacity must expose canvas, not desktop or stale image");
        var contained=Pixels(render("contain",1,0,100,0,1));Check(contained[0]==128 && !Same(original,contained),"contain must preserve letterboxing and source aspect ratio");
        var tiled=Pixels(render("tile",1,0,100,0,1));Check(!Same(original,tiled),"tile must honor tile size");
        for(int c=0;c<4;c++)Check(tiled[(25*64+20)*4+c]==tiled[(25*64+36)*4+c],"tile period must equal the theme setting");
        Check(render("cover",1,0,100,0,2).PixelWidth==128,"DPI must scale bitmap resolution without changing logical geometry");
        Check(CollectorWallpaper.Displacement(32,32,64,64,16,24).Length==0,"glass interior must not move");
        var edge=CollectorWallpaper.Displacement(.5,32,64,64,16,24);Check(edge.X<0 && edge.Y==0,"left edge must follow the web contour normal");
        Check(Math.Abs(edge.X+Math.Pow(1-.5/10,2)*12)<.00001,"refraction uses SVG channel scale, not an independent strength");
        Check(CollectorWallpaper.Displacement(.5,32,64,64,16,0).Length==0,"zero refraction disables displacement");
    }
    public static void Run(string data) {
        CheckEffects();
        CheckControls();
        var json=new JavaScriptSerializer {MaxJsonLength=64*1024*1024};
        var input=json.Deserialize<Dictionary<string,object>>(data);
        var appearance=(Dictionary<string,object>)input["appearance"];
        var view=new AtelierCollectorView(json.Serialize(appearance));
        view.SetWallpapers((Dictionary<string,object>)input["wallpapers"]);
        IntPtr handle=new WindowInteropHelper(view).EnsureHandle();
        try {
            IntPtr owner=GetWindow(handle,4);
            Check(!IsWindowVisible(handle),"test must not show a window");
            Check(view.GetType().Assembly.GetType("CollectorComposition")==null && view.GetType().Assembly.GetType("CollectorBackdropWindow")==null,"desktop sampling must no longer be compiled");
            foreach(bool dark in new[]{false,true,false}) {
                view.TestSystemTheme(dark);
                var report=json.Deserialize<Dictionary<string,object>>(json.Serialize(view.Report("synthetic")));
                var actual=(Dictionary<string,object>)report["appearance"];
                Check((string)actual["renderer"]=="theme-image" && (string)actual["wallpaper"]==(dark?"dark":"light"),"system changes must switch the wallpaper in place");
                Check((bool)report["noActivate"] && !(bool)report["foreground"],"collector must not take focus");
                Check(view.NativeHandle==handle && GetWindow(handle,4)==owner,"theme changes must retain one HWND and its original owner");
                view.ToggleCollapsed();Check(view.Height==44,"collapsed geometry");view.ToggleCollapsed();Check(view.Height==232,"expanded geometry");
            }
            string command="";view.Command+=(name,value)=>command=name+":"+value;
            view.ModeButtons[2].RaiseEvent(new RoutedEventArgs(Button.ClickEvent));Check(command=="mode:content","mode commands must remain connected");
            appearance["themeMode"]="dark";
            appearance["materials"]=new Dictionary<string,object>{{"dark",new Dictionary<string,object>{{"kind","glass"},{"opacity",0},{"blur",0},{"saturation",100},{"controlRadius",32}}}};
            var images=(Dictionary<string,object>)input["wallpapers"];
            appearance["images"]=new Dictionary<string,object>{{"dark",images["light"]}};
            view.ApplyAppearance(appearance);
            var canvas=(Canvas)((System.Windows.Controls.Grid)view.Content).Children[3];var title=(System.Windows.Controls.TextBlock)canvas.Children[3];
            Check(((SolidColorBrush)view.SurfaceBrush).Color.A==0,"readability must not silently increase theme opacity");
            Check(((SolidColorBrush)title.Inlines.FirstInline.Background).Color.A>0,"light image behind dark-theme text must get a local text backing");
            Check(((CornerRadius)view.ModeButtons[0].Tag).TopLeft==32,"custom control radius must not be capped");
            view.ApplyAppearance(new Dictionary<string,object>{{"surfaces","solid"}});
            var solid=json.Deserialize<Dictionary<string,object>>(json.Serialize(view.Report("synthetic")));
            Check((string)((Dictionary<string,object>)solid["appearance"])["renderer"]=="solid","default theme must remove wallpaper");
            Check(!IsWindowVisible(handle),"checks must keep the window hidden");
        } finally {view.Close();}
        Check(!IsWindow(handle),"closing must release the native window");
        Console.WriteLine("hidden wallpaper window passed");
    }
}
