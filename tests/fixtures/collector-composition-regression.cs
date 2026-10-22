using System;
using System.Numerics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

public static class CollectorCompositionRegression {
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window,int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect bounds);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    static void Check(bool value,string message) {if(!value)throw new Exception(message);}
    static object Field(object value,string name) {return value.GetType().GetField(name,BindingFlags.NonPublic|BindingFlags.Instance).GetValue(value);}
    static void Sync(AtelierCollectorView view) {typeof(AtelierCollectorView).GetMethod("UpdateWindowShape",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(view,null);}
    static IntPtr Backdrop(AtelierCollectorView view) {var host=Field(view,"backdrop");return host==null ? IntPtr.Zero : (IntPtr)host.GetType().GetProperty("Handle").GetValue(host,null);}
    static void CheckHidden(AtelierCollectorView view,IntPtr host) {Check(!view.IsVisible && !IsWindowVisible(view.NativeHandle) && !IsWindowVisible(host),"attachment tests must never show either window");}
    public static void RunWindowAttachment() {
        const string glass="{\"themeMode\":\"dark\",\"surfaces\":\"translucent\",\"motion\":\"off\",\"materials\":{\"dark\":{\"kind\":\"glass\",\"opacity\":0.4,\"blur\":22,\"saturation\":135,\"refraction\":8,\"panelRadius\":22}}}";
        var view=new AtelierCollectorView(glass);IntPtr host=IntPtr.Zero;
        try {
            Check(view.AllowsTransparency,"WPF foreground must use per-pixel alpha before its HWND is created");
            var foreground=new WindowInteropHelper(view).EnsureHandle();
            var source=HwndSource.FromHwnd(foreground);
            Check(source.UsesPerPixelOpacity && source.CompositionTarget.BackgroundColor.A==0,"actual WPF HWND must preserve foreground alpha");
            Check((GetWindowLong(foreground,-20)&0x80000)!=0,"WPF must own a layered foreground HWND");
            host=Backdrop(view);Check(host!=IntPtr.Zero && host!=foreground && IsWindow(host),"glass must attach to a separate native background HWND");
            Check(GetWindow(foreground,4)==host,"foreground must remain above its background owner");
            Check((GetWindowLong(host,-20)&0x80000)==0,"Composition target cannot use WPF's layered HWND");
            Check((GetWindowLong(host,-20)&0x08000080)==0x08000080,"background must remain a non-activating tool window");
            Check(view.NativeBackdrop && Field(view,"composition")!=null,"hidden attachment must reach the real Composition target, not a solid fallback");
            CheckHidden(view,host);
            foreach(int height in new[]{290,55,348}) {
                Check(SetWindowPos(foreground,IntPtr.Zero,40,60,480,height,0x0004|0x0010),"move synthetic hidden foreground");Sync(view);
                Rect a,b;Check(GetWindowRect(foreground,out a) && GetWindowRect(host,out b) && a.Equals(b),"background must follow physical position and collapsed size");CheckHidden(view,host);
            }
            view.ToggleCollapsed();Sync(view);Rect collapsedForeground,collapsedBackground;
            Check(GetWindowRect(foreground,out collapsedForeground) && GetWindowRect(host,out collapsedBackground) && collapsedForeground.Equals(collapsedBackground),"real collapse must keep both windows aligned");
            Check(view.Height==44 && collapsedForeground.Bottom-collapsedForeground.Top==(int)Math.Round(44*source.CompositionTarget.TransformToDevice.M22),"collapsed HWND must use the actual DPI height");
            view.ToggleCollapsed();
            var live=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(glass);
            var parameters=(System.Collections.Generic.Dictionary<string,object>)((System.Collections.Generic.Dictionary<string,object>)live["materials"])["dark"];
            parameters["opacity"]=.73;parameters["blur"]=0;parameters["saturation"]=180;parameters["refraction"]=24;parameters["panelRadius"]=3;
            view.ApplyAppearance(live);var effect=(CollectorComposition)Field(view,"composition");
            Check(Backdrop(view)==host && effect.Blur==0 && effect.Saturation==1.8f && effect.LensCount>0,"live settings must reach attached effects without replacing either HWND");
            Check(((SolidColorBrush)view.SurfaceBrush).Color.A==186,"attached WPF tint must keep its live opacity");CheckHidden(view,host);
            parameters["opacity"]=0;view.ApplyAppearance(live);
            Check(((SolidColorBrush)view.SurfaceBrush).Color.A==0 && ((SolidColorBrush)((Grid)view.Content).Background).Color.A==1,"zero tint must retain a minimal native hit surface for full button and drag areas");
            Check(Field(view,"composition")!=null,"zero tint must keep blur, saturation and refraction enabled");
            view.UpdateState(new CollectorViewState {Mode="content",Saved=3});
            var root=(Grid)view.Content;root.Measure(new Size(view.Width,view.Height));root.Arrange(new System.Windows.Rect(0,0,view.Width,view.Height));root.UpdateLayout();
            var bitmap=new RenderTargetBitmap((int)view.Width,(int)view.Height,96,96,PixelFormats.Pbgra32);bitmap.Render(root);
            byte[] pixels=new byte[(int)view.Width*44*4];bitmap.CopyPixels(new Int32Rect(0,0,(int)view.Width,44),pixels,(int)view.Width*4,0);
            int textPixels=0;for(int i=0;i<pixels.Length;i+=4)if(pixels[i]>180 && pixels[i+1]>180 && pixels[i+2]>180 && pixels[i+3]>220)textPixels++;
            Check(textPixels>30,"attached foreground must still paint readable title and button pixels");
            string command="";view.Command+=(name,value)=>command=name+":"+value;view.ModeButtons[0].RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Check(command=="mode:style","foreground controls must retain their original commands");
            IntPtr previousOwner=(IntPtr)Field(Field(view,"backdrop"),"previousOwner");
            view.ApplyAppearance(new System.Collections.Generic.Dictionary<string,object>{{"surfaces","solid"}});
            Check(!IsWindow(host) && Backdrop(view)==IntPtr.Zero && GetWindow(foreground,4)==previousOwner,"solid mode must detach and destroy only the background; alive="+IsWindow(host)+", owner="+GetWindow(foreground,4)+", expected="+previousOwner);
            Check(!view.NativeBackdrop && ((SolidColorBrush)view.SurfaceBrush).Color.A==255,"solid fallback must preserve readable WPF content");
            view.ApplyAppearance(new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(glass));
            host=Backdrop(view);Check(host!=IntPtr.Zero && host!=foreground && Field(view,"composition")!=null,"returning to glass must reattach the effects");CheckHidden(view,host);
        } finally {view.Close();}
        Check(!IsWindow(host),"closing the collector must release its background HWND");
        Console.WriteLine("hidden native attachment passed without showing windows or capturing screen");
    }
    static float BrushScalar(CollectorComposition composition,string key) {
        var brush=typeof(CollectorComposition).GetField("bodyBrush",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(composition);
        var properties=brush.GetType().GetProperty("Properties").GetValue(brush,null);object[] arguments={key,0f};
        var status=properties.GetType().GetMethod("TryGetScalar").Invoke(properties,arguments);
        Check(status.ToString()=="Succeeded","real brush property must exist: "+key);return (float)arguments[1];
    }
    static Matrix3x2 LensMatrix(CollectorComposition composition) {
        var brushes=(System.Collections.IList)typeof(CollectorComposition).GetField("lensBrushes",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(composition);
        var properties=brushes[0].GetType().GetProperty("Properties").GetValue(brushes[0],null);object[] arguments={"Lens.Matrix",Matrix3x2.Identity};
        Check(properties.GetType().GetMethod("TryGetMatrix3x2").Invoke(properties,arguments).ToString()=="Succeeded","real lens matrix must exist");return (Matrix3x2)arguments[1];
    }
    public static void Run() {
        Check(CollectorComposition.BuildLens(384,232,22,0).Count==0,"zero refraction must remove all lens patches");
        var cells=CollectorComposition.BuildLens(384,232,22,8);
        Check(cells.Count>0 && cells.Count<400,"lens geometry must remain a bounded edge mesh");
        bool left=false,right=false,corner=false;
        foreach(var cell in cells) {
            Check(cell.X>=0 && cell.Y>=0 && cell.X+cell.Width<=384 && cell.Y+cell.Height<=232,"lens bounds");
            Check(!(cell.X>24 && cell.X<352 && cell.Y>24 && cell.Y<200),"central content must not be distorted");
            Matrix3x2 sample;Check(Matrix3x2.Invert(cell.Transform,out sample),"lens mapping must remain invertible");
            var p=new Vector2(cell.X+cell.Width/2,cell.Y+cell.Height/2);var d=Vector2.Transform(p,sample)-p;
            if(cell.X==0 && cell.Y>24 && cell.Y<200) {Check(d.X<0 && Math.Abs(d.Y)<.01,"left edge must sample displaced real background");left=true;}
            if(cell.X+cell.Width==384 && cell.Y>24 && cell.Y<200) {Check(d.X>0 && Math.Abs(d.Y)<.01,"right edge symmetry");right=true;}
            if(cell.X>0 && cell.X<16 && cell.Y>0 && cell.Y<16 && Math.Abs(d.X)>.01 && Math.Abs(d.Y)>.01) {Check(d.X<0 && d.Y<0,"rounded corner needs both displacement axes");corner=true;}
        }
        Check(left && right && corner,"straight and rounded edges must be covered");
        using(var composition=new CollectorComposition()) {
            foreach(float dpi in new[]{1f,1.25f,1.5f,2f}) {
                composition.Update(384,232,22,22,135,8,dpi);
                Check(composition.Blur==22*dpi && composition.Saturation==1.35f && composition.LensCount==cells.Count,"settings must reach real effect brushes at each DPI");
                Check(BrushScalar(composition,"Blur.Amount")==22*dpi && BrushScalar(composition,"Saturation.Amount")==1.35f,"real GPU property sets must contain the live settings");
                var expected=cells[0].Transform;expected.M31*=dpi;expected.M32*=dpi;
                Check(LensMatrix(composition).Equals(expected),"edge displacement must reach the real shader matrix, including DPI translation");
                composition.Update(384,44,22,0,100,0,dpi);
                Check(composition.Blur==0 && composition.Saturation==1 && composition.LensCount==0,"live setting changes and collapse must clear previous effects");
                composition.Update(384,232,3,40,200,24,dpi);
                Check(composition.Blur==40*dpi && composition.Saturation==2 && composition.LensCount>0,"maximum custom settings must compile and apply");
            }
        }
        Console.WriteLine("composition effects passed without a window or screen capture");
    }
}
