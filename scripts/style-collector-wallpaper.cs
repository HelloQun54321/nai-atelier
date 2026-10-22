// 只处理传入的主题图片；按控件实际尺寸应用材质，不访问任何桌面窗口。
using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;

public static class CollectorWallpaper {
    public static BitmapSource Render(BitmapSource image,string fit,double opacity,double tileSize,Color canvas,double width,double height,double scale,double blur,double saturation,double refraction,double radius) {
        int w=Math.Max(1,(int)Math.Ceiling(width*scale)),h=Math.Max(1,(int)Math.Ceiling(height*scale));
        var drawing=new DrawingGroup();
        using(var dc=drawing.Open()) {
            dc.DrawRectangle(new SolidColorBrush(canvas),null,new Rect(0,0,width,height));
            if(image!=null) {
                var brush=new ImageBrush(image) {Stretch=fit=="contain"?Stretch.Uniform:Stretch.UniformToFill,Opacity=opacity};
                if(fit=="tile") {
                    double tileHeight=tileSize*image.PixelHeight/image.PixelWidth;
                    brush.TileMode=TileMode.Tile;brush.Stretch=Stretch.Fill;brush.ViewportUnits=BrushMappingMode.Absolute;
                    brush.Viewport=new Rect((width-tileSize)/2,(height-tileHeight)/2,tileSize,tileHeight);
                }
                dc.DrawRectangle(brush,null,new Rect(0,0,width,height));
            }
        }
        var layer=new Border {Width=width,Height=height,Background=new DrawingBrush(drawing),Effect=blur>0 ? new BlurEffect {Radius=blur,KernelType=KernelType.Gaussian,RenderingBias=RenderingBias.Quality} : null};
        layer.Measure(new Size(width,height));layer.Arrange(new Rect(0,0,width,height));layer.UpdateLayout();
        var bitmap=new RenderTargetBitmap(w,h,96*scale,96*scale,PixelFormats.Pbgra32);bitmap.Render(layer);
        byte[] pixels=new byte[w*h*4];bitmap.CopyPixels(pixels,w*4,0);
        double factor=saturation/100;
        for(int i=0;i<pixels.Length;i+=4) {
            double alpha=pixels[i+3]/255d;
            double b=pixels[i]+canvas.B*(1-alpha),g=pixels[i+1]+canvas.G*(1-alpha),r=pixels[i+2]+canvas.R*(1-alpha);
            double gray=.213*r+.715*g+.072*b;
            pixels[i]=Byte(gray+(b-gray)*factor);pixels[i+1]=Byte(gray+(g-gray)*factor);pixels[i+2]=Byte(gray+(r-gray)*factor);pixels[i+3]=255;
        }
        if(refraction>0) pixels=Refract(pixels,w,h,scale,refraction,radius);
        var result=BitmapSource.Create(w,h,96*scale,96*scale,PixelFormats.Pbgra32,null,pixels,w*4);result.Freeze();return result;
    }
    static byte Byte(double value) {return (byte)Math.Round(Math.Max(0,Math.Min(255,value)));}
    // 与 useGlassRefraction.ts 相同的圆角矩形法线和衰减；SVG 的位移通道范围为 -0.5～0.5。
    public static Vector Displacement(double x,double y,double width,double height,double radius,double refraction) {
        double r=Math.Max(0,Math.Min(radius,Math.Min(width,height)/2)),band=Math.Min(10,Math.Min(Math.Max(2,r*.65),Math.Min(width,height)/3));
        double px=x-width/2,py=y-height/2,qx=Math.Abs(px)-width/2+r,qy=Math.Abs(py)-height/2+r;
        double ox=Math.Max(qx,0),oy=Math.Max(qy,0),corner=Math.Sqrt(ox*ox+oy*oy),depth=r-corner-Math.Min(Math.Max(qx,qy),0);
        double strength=Math.Pow(Math.Max(0,1-Math.Max(0,depth)/band),2);
        double nx=corner>0?Math.Sign(px)*ox/corner:qx>qy?Math.Sign(px):0,ny=corner>0?Math.Sign(py)*oy/corner:qy>=qx?Math.Sign(py):0;
        return new Vector(nx*strength*refraction/2,ny*strength*refraction/2);
    }
    static byte[] Refract(byte[] input,int width,int height,double scale,double refraction,double radius) {
        var output=new byte[input.Length];
        for(int y=0;y<height;y++)for(int x=0;x<width;x++) {
            var shift=Displacement((x+.5)/scale,(y+.5)/scale,width/scale,height/scale,radius,refraction);
            double sx=Math.Max(0,Math.Min(width-1,x+shift.X*scale)),sy=Math.Max(0,Math.Min(height-1,y+shift.Y*scale));
            int x0=(int)sx,y0=(int)sy,x1=Math.Min(width-1,x0+1),y1=Math.Min(height-1,y0+1),p=(y*width+x)*4;
            double dx=sx-x0,dy=sy-y0;
            for(int c=0;c<3;c++) output[p+c]=Byte((input[(y0*width+x0)*4+c]*(1-dx)+input[(y0*width+x1)*4+c]*dx)*(1-dy)+(input[(y1*width+x0)*4+c]*(1-dx)+input[(y1*width+x1)*4+c]*dx)*dy);
            output[p+3]=255;
        }
        return output;
    }
}
