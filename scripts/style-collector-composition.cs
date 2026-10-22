// Windows Composition 直接合成窗口后方内容；不截屏、不读取或保存桌面像素。
using System;
using System.Collections.Generic;
using System.Numerics;
using System.Runtime.InteropServices;
using Windows.Graphics.Effects;
using Windows.UI.Composition;

// 背景独占原生窗口，WPF 以前景 Alpha 窗口叠加，避免争用同一个渲染目标。
public sealed class CollectorBackdropWindow : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Margins {public int Left,Right,Top,Bottom;public Margins(int value){Left=Right=Top=Bottom=value;}}
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] struct AccentPolicy {public int State,Flags,GradientColor,Animation;}
    [StructLayout(LayoutKind.Sequential)] struct CompositionAttribute {public int Attribute;public IntPtr Data;public int Size;}
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowEx(int extendedStyle,string className,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect bounds);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr window,IntPtr region,bool redraw);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int left,int top,int right,int bottom,int width,int height);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr window,ref Margins margins);
    [DllImport("user32.dll")][return:MarshalAs(UnmanagedType.Bool)] static extern bool SetWindowCompositionAttribute(IntPtr window,ref CompositionAttribute data);
    readonly System.Windows.Interop.WindowInteropHelper foreground;
    readonly IntPtr previousOwner;
    string shape;
    public IntPtr Handle {get;private set;}
    public CollectorBackdropWindow(System.Windows.Window view) {
        foreground=new System.Windows.Interop.WindowInteropHelper(view);previousOwner=foreground.Owner;
        if(foreground.Handle==IntPtr.Zero)throw new ArgumentException("收集前景窗口尚未创建");
        Handle=CreateWindowEx(0x08000000|0x00200000|0x00000080|0x00000020|0x00000008,"Static","",0x80000000,0,0,1,1,previousOwner,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        if(Handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {foreground.Owner=Handle;}catch {DestroyWindow(Handle);Handle=IntPtr.Zero;throw;}
    }
    public bool PrepareComposition(bool dark) {
        int enabled=1,darkFlag=dark?1:0,corner=1,backdrop=1;
        DwmSetWindowAttribute(Handle,20,ref darkFlag,4);DwmSetWindowAttribute(Handle,33,ref corner,4);DwmSetWindowAttribute(Handle,38,ref backdrop,4);
        var margins=new Margins(-1);
        return DwmExtendFrameIntoClientArea(Handle,ref margins)>=0 && DwmSetWindowAttribute(Handle,17,ref enabled,4)>=0;
    }
    public bool SetBackgroundBlur(bool enabled) {
        var policy=new AccentPolicy {State=enabled?3:0,Flags=2};
        IntPtr memory=Marshal.AllocHGlobal(Marshal.SizeOf(policy));
        try {Marshal.StructureToPtr(policy,memory,false);var data=new CompositionAttribute {Attribute=19,Data=memory,Size=Marshal.SizeOf(policy)};return SetWindowCompositionAttribute(Handle,ref data);}
        finally {Marshal.FreeHGlobal(memory);}
    }
    public void Sync(double radius) {
        Rect bounds;if(Handle==IntPtr.Zero || !GetWindowRect(foreground.Handle,out bounds))return;
        int width=bounds.Right-bounds.Left,height=bounds.Bottom-bounds.Top;
        string next=width+":"+height+":"+radius;
        if(next!=shape && width>0 && height>0) {
            int diameter=(int)Math.Round(radius*2);IntPtr region=CreateRoundRectRgn(0,0,width+1,height+1,diameter,diameter);
            if(region!=IntPtr.Zero) {if(SetWindowRgn(Handle,region,true)==0)DeleteObject(region);else shape=next;}
        }
        SetWindowPos(Handle,foreground.Handle,bounds.Left,bounds.Top,width,height,0x0010|0x0200|(IsWindowVisible(foreground.Handle)?0x0040u:0x0080u));
    }
    public void Dispose() {
        if(Handle==IntPtr.Zero)return;
        // 先解除所有权；销毁 owner 会连同其拥有的前景窗口一起销毁。
        if(IsWindow(foreground.Handle) && foreground.Owner==Handle)foreground.Owner=previousOwner;
        DestroyWindow(Handle);Handle=IntPtr.Zero;
    }
}

[ComImport,Guid("2FC57384-A068-44D7-A331-30982FCF7177"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICollectorEffectInterop {
    void GetEffectId(out Guid id);
    void GetNamedPropertyMapping([MarshalAs(UnmanagedType.LPWStr)] string name,out uint index,out uint mapping);
    void GetPropertyCount(out uint count);
    void GetProperty(uint index,out IntPtr value);
    void GetSource(uint index,out IGraphicsEffectSource source);
    void GetSourceCount(out uint count);
}

[ComVisible(true),ClassInterface(ClassInterfaceType.None),ComDefaultInterface(typeof(IGraphicsEffect))]
public sealed class CollectorEffect : IGraphicsEffect, IGraphicsEffectSource, ICollectorEffectInterop {
    readonly Guid id; readonly string[] names; readonly object[] properties; readonly IGraphicsEffectSource[] sources;
    public string Name {get;set;}
    public CollectorEffect(string name,string effect,string[] keys,object[] values,params IGraphicsEffectSource[] inputs) {Name=name;id=new Guid(effect);names=keys;properties=values;sources=inputs;}
    public void GetEffectId(out Guid value) {value=id;}
    public void GetNamedPropertyMapping(string name,out uint index,out uint mapping) {int i=Array.IndexOf(names,name); if(i<0) throw new ArgumentException("Unknown effect property"); index=(uint)i; mapping=1;}
    public void GetPropertyCount(out uint count) {count=(uint)properties.Length;}
    public void GetProperty(uint index,out IntPtr value) {value=CollectorPropertyValue.Create(properties[index]);}
    public void GetSource(uint index,out IGraphicsEffectSource source) {source=sources[index];}
    public void GetSourceCount(out uint count) {count=(uint)sources.Length;}
    public static CollectorEffect BackgroundGraph() {
        var blur=new CollectorEffect("Blur","1feb6d69-2fe6-4ac9-8c58-1d7f93e7a6a5",new[]{"Amount","Optimization","Border"},new object[]{0f,1u,1u},new CompositionEffectSourceParameter("Background"));
        return new CollectorEffect("Saturation","5cb2d9cf-327d-459f-a0ce-40c0b2086bf7",new[]{"Amount"},new object[]{1f},blur);
    }
    public static CollectorEffect LensGraph() {return new CollectorEffect("Lens","6aa97485-6354-4cfc-908c-e4a74f62c96c",new[]{"Interpolation","Border","Matrix","Sharpness"},new object[]{1u,1u,new float[]{1,0,0,1,0,0},0f},new CompositionEffectSourceParameter("Background"));}
}

// 保留 IPropertyValue 的原生接口；CLR 自动拆箱会把效果属性变成无效的 COM 输出。
static class CollectorPropertyValue {
    [DllImport("combase.dll",CharSet=CharSet.Unicode)] static extern int WindowsCreateString(string value,int length,out IntPtr text);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr text);
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr text,ref Guid iid,out IntPtr factory);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SingleValue(IntPtr self,float value,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int UIntValue(IntPtr self,uint value,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ArrayValue(IntPtr self,uint count,[MarshalAs(UnmanagedType.LPArray,SizeParamIndex=1)]float[] value,out IntPtr result);
    public static IntPtr Create(object value) {
        IntPtr text,factory=IntPtr.Zero,result;
        const string name="Windows.Foundation.PropertyValue";Marshal.ThrowExceptionForHR(WindowsCreateString(name,name.Length,out text));
        try {
            var iid=new Guid("629bdbc8-d932-4ff4-96b9-8d96c5c1e858");Marshal.ThrowExceptionForHR(RoGetActivationFactory(text,ref iid,out factory));
            IntPtr table=Marshal.ReadIntPtr(factory);
            if(value is float) Marshal.ThrowExceptionForHR(((SingleValue)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,14*IntPtr.Size),typeof(SingleValue)))(factory,(float)value,out result));
            else if(value is uint) Marshal.ThrowExceptionForHR(((UIntValue)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,11*IntPtr.Size),typeof(UIntValue)))(factory,(uint)value,out result));
            else {var values=(float[])value;Marshal.ThrowExceptionForHR(((ArrayValue)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,33*IntPtr.Size),typeof(ArrayValue)))(factory,(uint)values.Length,values,out result));}
            return result;
        } finally {if(factory!=IntPtr.Zero)Marshal.Release(factory);WindowsDeleteString(text);}
    }
}

public sealed class CollectorLensCell {
    public float X,Y,Width,Height;
    public Matrix3x2 Transform;
}

public sealed class CollectorComposition : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct QueueOptions { public int Size,Thread,Apartment; }
    [DllImport("CoreMessaging.dll")] static extern int CreateDispatcherQueueController(QueueOptions options,[MarshalAs(UnmanagedType.IUnknown)]out object controller);
    [ComImport,Guid("29E691FA-4567-4DCA-B319-D0F207EB6807"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDesktopInterop {void CreateDesktopWindowTarget(IntPtr window,[MarshalAs(UnmanagedType.Bool)]bool topmost,out IntPtr target);}
    [ThreadStatic] static object queue;
    readonly Compositor compositor;
    readonly CompositionEffectFactory factory;
    readonly CompositionEffectFactory backgroundFactory;
    readonly CompositionBackdropBrush background;
    readonly CompositionVisualSurface sampledSurface;
    readonly CompositionSurfaceBrush sampledBrush;
    readonly ContainerVisual root;
    readonly SpriteVisual body;
    readonly CompositionEffectBrush bodyBrush;
    readonly CompositionRoundedRectangleGeometry roundGeometry;
    readonly CompositionGeometricClip roundedClip;
    readonly List<SpriteVisual> lenses=new List<SpriteVisual>();
    readonly List<CompositionEffectBrush> lensBrushes=new List<CompositionEffectBrush>();
    Windows.UI.Composition.Desktop.DesktopWindowTarget target;
    string geometry;
    public float Blur {get;private set;}
    public float Saturation {get;private set;}
    public int LensCount {get {return lenses.Count;}}

    public CollectorComposition() {
        if(queue==null) Marshal.ThrowExceptionForHR(CreateDispatcherQueueController(new QueueOptions {Size=Marshal.SizeOf(typeof(QueueOptions)),Thread=2,Apartment=2},out queue));
        compositor=new Compositor();
        backgroundFactory=compositor.CreateEffectFactory(CollectorEffect.BackgroundGraph(),new[]{"Blur.Amount","Saturation.Amount"});
        factory=compositor.CreateEffectFactory(CollectorEffect.LensGraph(),new[]{"Lens.Matrix"});
        background=compositor.CreateHostBackdropBrush();
        root=compositor.CreateContainerVisual();
        body=compositor.CreateSpriteVisual();bodyBrush=backgroundFactory.CreateBrush();bodyBrush.SetSourceParameter("Background",background);body.Brush=bodyBrush;root.Children.InsertAtBottom(body);
        sampledSurface=compositor.CreateVisualSurface();sampledSurface.SourceVisual=body;
        sampledBrush=compositor.CreateSurfaceBrush(sampledSurface);sampledBrush.Stretch=CompositionStretch.None;
        roundGeometry=compositor.CreateRoundedRectangleGeometry();roundedClip=compositor.CreateGeometricClip(roundGeometry);root.Clip=roundedClip;
    }
    CompositionEffectBrush CreateBrush(Matrix3x2 matrix) {
        var brush=factory.CreateBrush(); brush.SetSourceParameter("Background",sampledBrush);
        brush.Properties.InsertMatrix3x2("Lens.Matrix",matrix);return brush;
    }
    public void Attach(IntPtr window) {
        if(window==IntPtr.Zero) throw new ArgumentException("A real collector window is required");
        IntPtr raw; ((IDesktopInterop)(object)compositor).CreateDesktopWindowTarget(window,false,out raw);
        try {target=(Windows.UI.Composition.Desktop.DesktopWindowTarget)Marshal.GetObjectForIUnknown(raw);target.Root=root;}finally {Marshal.Release(raw);}
    }
    public void Update(float width,float height,float radius,float blur,float saturation,float refraction,float scale) {
        Blur=blur*scale;Saturation=saturation/100;
        body.Size=new Vector2(width*scale,height*scale);
        sampledSurface.SourceSize=body.Size;
        bodyBrush.Properties.InsertScalar("Blur.Amount",Blur);bodyBrush.Properties.InsertScalar("Saturation.Amount",Saturation);
        roundGeometry.Size=body.Size;roundGeometry.CornerRadius=new Vector2(radius*scale);
        string next=width+":"+height+":"+radius+":"+refraction+":"+scale;
        if(next!=geometry) {
            foreach(var lens in lenses) {root.Children.Remove(lens);lens.Dispose();} foreach(var brush in lensBrushes)brush.Dispose();lenses.Clear();lensBrushes.Clear();
            foreach(var cell in BuildLens(width,height,radius,refraction)) {
                var matrix=cell.Transform;matrix.M31*=scale;matrix.M32*=scale;
                var brush=CreateBrush(matrix);var lens=compositor.CreateSpriteVisual();lens.Size=body.Size;lens.Brush=brush;
                lens.Clip=compositor.CreateInsetClip(cell.X*scale,cell.Y*scale,Math.Max(0,(width-cell.X-cell.Width)*scale),Math.Max(0,(height-cell.Y-cell.Height)*scale));
                lenses.Add(lens);lensBrushes.Add(brush);root.Children.InsertAtTop(lens);
            }
            geometry=next;
        }
    }
    // 与 useGlassRefraction.ts 同一圆角矩形法线；分片仿射重采样真实背景，不绘制假的折射色带。
    static Vector2 Displacement(float x,float y,float width,float height,float radius,float amount) {
        float r=Math.Max(0,Math.Min(radius,Math.Min(width,height)/2)),band=Math.Min(10,Math.Min(Math.Max(2,r*.65f),Math.Min(width,height)/3));
        float px=x-width/2,py=y-height/2,qx=Math.Abs(px)-width/2+r,qy=Math.Abs(py)-height/2+r,ox=Math.Max(qx,0),oy=Math.Max(qy,0),corner=(float)Math.Sqrt(ox*ox+oy*oy);
        float depth=r-corner-Math.Min(Math.Max(qx,qy),0),strength=Math.Max(0,1-Math.Max(0,depth)/band);strength*=strength;
        float nx=corner>0 ? Math.Sign(px)*ox/corner : qx>qy ? Math.Sign(px) : 0,ny=corner>0 ? Math.Sign(py)*oy/corner : qy>=qx ? Math.Sign(py) : 0;
        return new Vector2(nx,ny)*strength*amount*.5f;
    }
    public static List<CollectorLensCell> BuildLens(float width,float height,float radius,float amount) {
        var result=new List<CollectorLensCell>();if(amount<=0 || width<=0 || height<=0)return result;
        List<float> xs=Coordinates(width,radius),ys=Coordinates(height,radius);
        for(int yi=0;yi<ys.Count-1;yi++)for(int xi=0;xi<xs.Count-1;xi++) {
            float x=xs[xi],y=ys[yi],w=xs[xi+1]-x,h=ys[yi+1]-y,cx=x+w/2,cy=y+h/2;
            var d=Displacement(cx,cy,width,height,radius,amount);if(d.LengthSquared()<.0001f)continue;
            var dx=(Displacement(cx+.25f,cy,width,height,radius,amount)-Displacement(cx-.25f,cy,width,height,radius,amount))*2;
            var dy=(Displacement(cx,cy+.25f,width,height,radius,amount)-Displacement(cx,cy-.25f,width,height,radius,amount))*2;
            var sample=new Matrix3x2(1+dx.X,dx.Y,dy.X,1+dy.Y,d.X-dx.X*cx-dy.X*cy,d.Y-dx.Y*cx-dy.Y*cy);
            Matrix3x2 transform;if(!Matrix3x2.Invert(sample,out transform))continue;
            result.Add(new CollectorLensCell {X=x,Y=y,Width=w,Height=h,Transform=transform});
        }
        return result;
    }
    static List<float> Coordinates(float length,float radius) {
        float r=Math.Min(radius,length/2),band=Math.Min(10,Math.Max(2,r*.65f));var points=new SortedSet<float>{0,length};
        foreach(float d in new[]{band/3,band*2/3,band,(band+r)/2,r})if(d>0 && d<length/2) {points.Add(d);points.Add(length-d);}
        for(float d=Math.Max(r,band)+16;d<length/2;d+=16) {points.Add(d);points.Add(length-d);}
        points.Add(length/2);return new List<float>(points);
    }
    public void Dispose() {
        if(target!=null) {target.Root=null;target.Dispose();target=null;}
        foreach(var lens in lenses)lens.Dispose();foreach(var brush in lensBrushes)brush.Dispose();
        sampledBrush.Dispose();sampledSurface.Dispose();body.Dispose();bodyBrush.Dispose();roundedClip.Dispose();roundGeometry.Dispose();root.Dispose();background.Dispose();factory.Dispose();backgroundFactory.Dispose();compositor.Dispose();
    }
}
