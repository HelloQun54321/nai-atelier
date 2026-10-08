package io.github.helloqun54321.naiatelier;

import android.content.Context;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import com.getcapacitor.*;
import org.json.*;

/** AITAG JSON 使用系统 Chromium 的实际浏览器网络，不注入应用桥或关闭证书验证。 */
final class AtelierBrowserRequest extends WebViewClient {
    final Context context;final PluginCall call;final AtelierPlugin.RequestJob job;final Runnable complete;
    final Handler handler=new Handler(Looper.getMainLooper());WebView view;boolean ended;int status=200;
    final Runnable timeout=()->fail("AITAG 浏览器连接超时");
    AtelierBrowserRequest(Context context,PluginCall call,AtelierPlugin.RequestJob job,Runnable complete){this.context=context;this.call=call;this.job=job;this.complete=complete;}
    static boolean allowed(String value){
        Uri uri=Uri.parse(value);String path=uri.getPath();
        return "https".equals(uri.getScheme())&&"aitag.win".equals(uri.getHost())&&uri.getUserInfo()==null&&(uri.getPort()==-1||uri.getPort()==443)&&path!=null&&path.matches("/api/(config|ai_works_search|rank/monthly/(real|fixed)|work/[0-9]+)");
    }
    void start(){
        String url=call.getString("url","");if(!allowed(url)){fail("不支持的 AITAG 接口");return;}
        job.browserCancel=()->handler.post(()->fail("请求已取消"));if(job.cancelled){fail("请求已取消");return;}
        view=new WebView(context);view.getSettings().setJavaScriptEnabled(true);view.getSettings().setAllowFileAccess(false);view.getSettings().setAllowContentAccess(false);
        java.util.Map<String,String> headers=new java.util.HashMap<>();JSObject requested=call.getObject("headers",new JSObject());
        for(java.util.Iterator<String> keys=requested.keys();keys.hasNext();){String name=keys.next();headers.put(name,requested.optString(name));}
        if(headers.containsKey("user-agent"))view.getSettings().setUserAgentString(headers.get("user-agent"));
        view.setWebViewClient(this);handler.postDelayed(timeout,30000);view.loadUrl(url,headers);
    }
    void close(){ended=true;handler.removeCallbacks(timeout);if(view!=null){view.stopLoading();view.destroy();view=null;}complete.run();}
    void fail(String error){if(!ended){close();call.reject(error);}}
    @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request){if(!allowed(request.getUrl().toString())){fail("AITAG 重定向到不支持的页面");return true;}return false;}
    @Override public void onReceivedHttpError(WebView web,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame())status=response.getStatusCode();}
    @Override public void onReceivedError(WebView web,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())fail("AITAG 连接失败："+error.getDescription());}
    @Override public void onReceivedSslError(WebView web,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();fail("AITAG 证书验证失败");}
    @Override public void onPageFinished(WebView web,String url){
        if(ended||!allowed(url))return;
        web.evaluateJavascript("JSON.stringify({text:document.body.innerText,type:document.contentType})",raw->{
            if(ended)return;
            try{
                JSONObject page=new JSONObject((String)new JSONTokener(raw).nextValue());String text=page.getString("text");
                if(text.length()>16*1024*1024)throw new IllegalStateException("AITAG 响应过大");
                JSObject reply=new JSObject();reply.put("status",status);reply.put("body",text);reply.put("type",page.getString("type"));reply.put("url",url);close();call.resolve(reply);
            }catch(Exception error){fail("AITAG 响应读取失败："+error.getMessage());}
        });
    }
}
