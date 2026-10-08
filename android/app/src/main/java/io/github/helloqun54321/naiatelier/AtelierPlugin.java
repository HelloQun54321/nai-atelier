package io.github.helloqun54321.naiatelier;

import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

@CapacitorPlugin(name="Atelier")
public class AtelierPlugin extends Plugin {
    AtelierStore store;
    AtelierTagger tagger;
    final ExecutorService storage = Executors.newSingleThreadExecutor();
    final ExecutorService network = Executors.newCachedThreadPool();
    static final class RequestJob {volatile boolean cancelled;volatile Call call;}
    final Map<String,RequestJob> connections = new ConcurrentHashMap<>();
    final java.util.concurrent.atomic.AtomicInteger backgroundTasks=new java.util.concurrent.atomic.AtomicInteger();
    final android.os.Handler taskHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    final Runnable stopTask=()->{if(backgroundTasks.get()==0)getContext().stopService(new Intent(getContext(),AtelierTaskService.class));};
    final OkHttpClient httpClient=new OkHttpClient.Builder().connectTimeout(30,TimeUnit.SECONDS).readTimeout(300,TimeUnit.SECONDS).build();
    final Map<String,CompletableFuture<JSObject>> localRequests = new ConcurrentHashMap<>();
    final Set<String> inspectedBackups=ConcurrentHashMap.newKeySet();

    @Override public void load() {
        try { store = new AtelierStore(getContext()); tagger = new AtelierTagger(getContext(),store); }
        catch (Exception e) { throw new IllegalStateException("手机工坊存储初始化失败",e); }
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public WebResourceResponse shouldInterceptRequest(android.webkit.WebView view,WebResourceRequest request) {
                Uri uri = request.getUrl(); String path = uri.getPath();
                if ("localhost".equals(uri.getHost()) && path != null && (path.startsWith("/api/") || path.startsWith("/tag-data/"))) {
                    String id = UUID.randomUUID().toString(); CompletableFuture<JSObject> reply = new CompletableFuture<>(); localRequests.put(id,reply);
                    getActivity().runOnUiThread(() -> view.evaluateJavascript("window.__atelierRequest && window.__atelierRequest("+JSONObject.quote(id)+","+JSONObject.quote(uri.toString())+")",null));
                    try {
                        JSObject result=reply.get(300,TimeUnit.SECONDS);
                        InputStream input;
                        if(result.has("path")){File file=new File(result.getString("path")).getCanonicalFile();if(!file.getPath().startsWith(store.root.getCanonicalPath()+File.separator)&&!file.getPath().startsWith(store.cache.getCanonicalPath()+File.separator))throw new IOException("资源路径越界");input=new FileInputStream(file);}
                        else input=new ByteArrayInputStream(Base64.decode(result.optString("data"),Base64.DEFAULT));
                        Map<String,String> headers=new HashMap<>(); JSONObject h=result.optJSONObject("headers"); if(h!=null) for(Iterator<String> k=h.keys();k.hasNext();) {String name=k.next();headers.put(name,h.getString(name));}
                        return new WebResourceResponse(result.optString("mime","application/octet-stream"),"UTF-8",result.optInt("status",200),"Response",headers,input);
                    } catch(Exception e) {return new WebResourceResponse("text/plain","UTF-8",500,"Error",new HashMap<>(),new ByteArrayInputStream("手机资源读取失败".getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
                    finally {localRequests.remove(id);}
                }
                return super.shouldInterceptRequest(view,request);
            }
        });
    }
    @PluginMethod public void respond(PluginCall call) { CompletableFuture<JSObject> reply=localRequests.get(call.getString("id")); if(reply!=null)reply.complete(call.getData()); call.resolve(); }
    interface Work { JSObject run() throws Exception; }
    void run(PluginCall call,ExecutorService executor,Work work) {executor.execute(()->{try{call.resolve(work.run());}catch(Exception e){call.reject(e.getMessage(),e);}});}
    @PluginMethod public void sql(PluginCall call) { run(call,storage,()-> {
        if(call.hasOption("database")) {
            String query=call.getString("sql");if(!query.trim().toUpperCase(Locale.ROOT).startsWith("SELECT"))throw new IOException("词库只允许只读查询");
            androidx.sqlite.SQLiteConnection connection=new androidx.sqlite.driver.bundled.BundledSQLiteDriver().open(store.file(call.getString("database"),true).getPath());
            androidx.sqlite.SQLiteStatement statement=connection.prepare(query);
            try{JSArray rows=new JSArray();while(statement.step()){JSObject row=new JSObject();for(int i=0;i<statement.getColumnCount();i++)row.put(statement.getColumnName(i),statement.getColumnType(i)==1?statement.getLong(i):statement.isNull(i)?JSONObject.NULL:statement.getText(i));rows.put(row);}JSObject result=new JSObject();result.put("results",rows);return result;}
            finally{statement.close();connection.close();}
        }
        if(call.hasOption("statements")) {JSObject result=new JSObject();result.put("results",store.batch(call.getArray("statements")));return result;}
        return store.query(call.getString("sql"),call.getArray("values",new JSArray()));
    }); }
    @PluginMethod public void object(PluginCall call) {run(call,storage,()->{
        String action=call.getString("action","get");
        if(action.equals("put"))return store.putObject(call.getString("key"),call.getString("temporary"),call.getString("mime","application/octet-stream"));
        if(action.equals("delete")) {store.deleteObject(call.getString("key"));return new JSObject();} return store.object(call.getString("key"));
    });}
    @PluginMethod public void file(PluginCall call) { run(call,storage,()-> {
        String action=call.getString("action"),path=call.getString("path"); boolean cached=call.getBoolean("cache",false);
        File file=store.file(path,cached); JSObject result=new JSObject();
        switch(action) {
            case "create": file.getParentFile().mkdirs();try{Files.createFile(file.toPath());}catch(java.nio.file.FileAlreadyExistsException e){throw new IOException("EEXIST: "+path);}break;
            case "write": file.getParentFile().mkdirs(); byte[] bytes=Base64.decode(call.getString("data",""),Base64.DEFAULT);
                if(file.getName().matches(".*\\.key(?:\\..*)?"))bytes=store.seal(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                try(OutputStream out=new FileOutputStream(file,call.getBoolean("append",false))) {out.write(bytes);} break;
            case "rename": File target=store.file(call.getString("to"),cached);target.getParentFile().mkdirs();Files.move(file.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);break;
            case "read": if(!file.isFile())throw new FileNotFoundException("ENOENT: "+path);byte[] content=Files.readAllBytes(file.toPath());
                if(file.getName().endsWith(".key"))content=store.unseal(new String(content,java.nio.charset.StandardCharsets.UTF_8)).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                result.put("data",Base64.encodeToString(content,Base64.NO_WRAP)); break;
            case "delete": Files.deleteIfExists(file.toPath());break;
            case "deleteTree": if(!cached)throw new IOException("只能清理可再生成的缓存目录");if(file.exists())try(java.util.stream.Stream<java.nio.file.Path> paths=Files.walk(file.toPath())){for(java.nio.file.Path entry:(Iterable<java.nio.file.Path>)paths.sorted(Comparator.reverseOrder())::iterator)Files.delete(entry);}break;
            case "mkdir": if(!file.isDirectory()&&!file.mkdirs())throw new IOException("无法创建目录");break;
            case "list": JSArray list=new JSArray();File[] files=file.listFiles();if(files!=null)for(File f:files) {JSObject entry=new JSObject();entry.put("name",f.getName());entry.put("directory",f.isDirectory());list.put(entry);}result.put("items",list);break;
            case "stat": if(!file.exists())throw new FileNotFoundException("ENOENT: "+path);result.put("directory",file.isDirectory());result.put("size",file.length());result.put("modified",file.lastModified());break;
            default: throw new IOException("未知文件操作");
        }
        result.put("path",file.getPath());return result;
    }); }
    @PluginMethod public void secure(PluginCall call) {run(call,storage,()-> {
        SharedPreferences prefs=getContext().getSharedPreferences("atelier-secrets",Context.MODE_PRIVATE);String name=call.getString("key");JSObject result=new JSObject();
        if(call.hasOption("value")) {String value=call.getString("value","");SharedPreferences.Editor edit=prefs.edit();if(value.isEmpty())edit.remove(name);else edit.putString(name,store.seal(value));if(!edit.commit())throw new IOException("凭据保存失败");}
        result.put("value",store.unseal(prefs.getString(name,"")));return result;
    });}
    void event(String id,String type,JSObject data) {data.put("id",id);data.put("type",type);notifyListeners("http",data);}
    static boolean publicAddress(InetAddress address){
        if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress())return false;
        byte[] bytes=address.getAddress();int a=bytes[0]&255,b=bytes[1]&255;
        if(bytes.length==4)return a!=0&&a!=10&&a!=127&&a<224&&!(a==100&&b>=64&&b<=127)&&!(a==169&&b==254)&&!(a==172&&b>=16&&b<=31)&&!(a==192&&(b==168||b==0||b==2))&&!(a==198&&(b==18||b==19||b==51&&(bytes[2]&255)==100))&&!(a==203&&b==0&&(bytes[2]&255)==113);
        return bytes.length==16&&(a&0xe0)==0x20&&!(a==0x20&&b==0x02)&&!(a==0x20&&b==0x01&&((bytes[2]==0&&bytes[3]==0)||(bytes[2]&255)==0x0d&&(bytes[3]&255)==0xb8));
    }
    @PluginMethod public void cancel(PluginCall call) {RequestJob job=connections.get(call.getString("id"));if(job!=null){job.cancelled=true;if(job.call!=null)job.call.cancel();}call.resolve();}
    @PluginMethod public void http(PluginCall call) {
      String id=call.getString("id");RequestJob job=new RequestJob();connections.put(id,job);
      boolean background=call.getBoolean("background",false);if(background){backgroundTasks.incrementAndGet();taskHandler.removeCallbacks(stopTask);try{getContext().startForegroundService(new Intent(getContext(),AtelierTaskService.class));}catch(RuntimeException e){android.util.Log.w("NAIAtelier","系统未允许后台任务保活");}}
      run(call,network,()->{
        String url=call.getString("url");Call connection=null;
        try {
            URL target=new URL(url);if(!target.getProtocol().equals("https")&&!target.getProtocol().equals("http"))throw new IOException("只支持 HTTP(S) 请求");
            OkHttpClient.Builder client=httpClient.newBuilder().followRedirects(!call.getBoolean("manual",false)).followSslRedirects(!call.getBoolean("manual",false));
            JSObject headers=call.getObject("headers",new JSObject());boolean publicWeb="1".equals(headers.optString("x-atelier-public-web"));
            if(publicWeb){if(target.getHost().matches("[0-9.]+")||target.getHost().contains(":"))throw new IOException("网页只允许公网域名");client.dns(host->{List<InetAddress> addresses=Arrays.asList(InetAddress.getAllByName(host));for(InetAddress address:addresses)if(!publicAddress(address))throw new UnknownHostException("网页只允许公网地址");return addresses;});}
            okhttp3.Request.Builder builder=new okhttp3.Request.Builder().url(url);for(Iterator<String> it=headers.keys();it.hasNext();) {String name=it.next();if(!name.equals("x-atelier-public-web"))builder.header(name,headers.getString(name));}
            RequestBody body=call.hasOption("body")?RequestBody.create(Base64.decode(call.getString("body"),Base64.DEFAULT),null):null;
            String method=call.getString("method","GET");if(body==null&&!method.equals("GET")&&!method.equals("HEAD"))body=RequestBody.create(new byte[0],null);
            connection=client.build().newCall(builder.method(method,body).build());job.call=connection;if(job.cancelled)throw new IOException("请求已取消");
            try(okhttp3.Response response=connection.execute()){
            int status=response.code();JSObject head=new JSObject(),responseHeaders=new JSObject();for(String name:response.headers().names())responseHeaders.put(name.toLowerCase(Locale.ROOT),String.join(", ",response.headers().values(name)));
            head.put("status",status);head.put("headers",responseHeaders);head.put("url",response.request().url().toString());event(id,"head",head);
            InputStream input=response.body()==null?null:response.body().byteStream();
            if(input!=null){
                File targetFile=call.hasOption("file")?store.file(call.getString("file"),true):null;if(targetFile!=null)targetFile.getParentFile().mkdirs();
                try(InputStream in=input;OutputStream out=targetFile==null?new ByteArrayOutputStream():new FileOutputStream(targetFile)){byte[] chunk=new byte[32768];int n;long total=0;while((n=in.read(chunk))!=-1){if(job.cancelled)throw new IOException("请求已取消");total+=n;if(total>call.getLong("maxBytes",Long.MAX_VALUE))throw new IOException("下载超过大小上限");if(targetFile!=null)out.write(chunk,0,n);else{JSObject data=new JSObject();data.put("data",Base64.encodeToString(chunk,0,n,Base64.NO_WRAP));event(id,"data",data);}}}
                if(targetFile!=null)head.put("path",targetFile.getPath());
            }
            event(id,"end",new JSObject());return head;
            }
        }catch(Exception e){JSObject error=new JSObject();error.put("error",e.getMessage());event(id,"error",error);throw e;}
        finally {connections.remove(id,job);if(background&&backgroundTasks.decrementAndGet()==0)taskHandler.postDelayed(stopTask,30000);}
    });}
    @PluginMethod public void tagger(PluginCall call) {run(call,network,()-> tagger.handle(call));}
    @PluginMethod public void saveFile(PluginCall call) {
        try{store.file(call.getString("path"),true);Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(call.getString("mime","application/octet-stream"));intent.putExtra(Intent.EXTRA_TITLE,call.getString("filename","NAI-Atelier"));startActivityForResult(call,intent,"fileSaved");}catch(Exception e){call.reject(e.getMessage(),e);}
    }
    @ActivityCallback private void fileSaved(PluginCall call,ActivityResult result) {
        if(call==null)return;if(result.getResultCode()!=android.app.Activity.RESULT_OK||result.getData()==null){call.reject("已取消保存");return;}
        Uri uri=result.getData().getData();run(call,storage,()->{File source=store.file(call.getString("path"),true);try(InputStream in=new FileInputStream(source);OutputStream out=getContext().getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("导出文件写入失败");AtelierBackup.copy(in,out);}if(call.getBoolean("removeAfterSave",false))Files.delete(source.toPath());return new JSObject();});
    }
    @PluginMethod public void backup(PluginCall call) {
        String action=call.getString("action");
        if("inspect".equals(action)){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");startActivityForResult(call,intent,"backupSelected");return;}
        run(call,storage,()->{
            if("export".equals(action)){File file=AtelierBackup.export(getContext(),store,call.getString("password",""),call.getObject("preferences",new JSObject()));JSObject result=new JSObject();result.put("path","backup/"+file.getName());return result;}
            if("restore".equals(action)){
                String id=call.getString("id");if(!inspectedBackups.remove(id))throw new IOException("请重新选择并验证备份");
                JSObject preferences=JSObject.fromJSONObject(new JSONObject(AtelierBackup.text(store.file("restore/"+id+"/preferences.json",true).toPath())));
                try{store=AtelierBackup.restore(getContext(),store,id);}catch(Exception e){store=new AtelierStore(getContext());throw e;}
                JSObject result=new JSObject();result.put("preferences",preferences);return result;
            }
            throw new IOException("未知备份操作");
        });
    }
    @ActivityCallback private void backupSelected(PluginCall call,ActivityResult result) {
        if(call==null)return;if(result.getResultCode()!=android.app.Activity.RESULT_OK||result.getData()==null){call.reject("已取消选择");return;}
        Uri uri=result.getData().getData();run(call,storage,()->{try(InputStream input=getContext().getContentResolver().openInputStream(uri)){JSObject info=AtelierBackup.inspect(input,getContext(),store,call.getString("password",""));inspectedBackups.add(info.getString("id"));return info;}});
    }
    @Override protected void handleOnNewIntent(Intent intent) { if(intent.getData()!=null&&"pixiv".equals(intent.getData().getScheme())){JSObject data=new JSObject();data.put("url",intent.getData().toString());notifyListeners("urlOpen",data);} }
    @PluginMethod public void openUrl(PluginCall call) {
        Uri uri=Uri.parse(call.getString("url"));if(!"https".equals(uri.getScheme())){call.reject("只允许打开 HTTPS 页面");return;}
        getActivity().startActivity(new Intent(Intent.ACTION_VIEW,uri));call.resolve();
    }
    @PluginMethod public void clipboard(PluginCall call) {
        getActivity().runOnUiThread(()->{
            try {
                ClipboardManager clipboard=(ClipboardManager)getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                String action=call.getString("action");
                if(action.equals("text")){clipboard.setPrimaryClip(ClipData.newPlainText("文字",call.getString("value","")));call.resolve();return;}
                ClipData clip=clipboard.getPrimaryClip();if(clip==null||clip.getItemCount()==0)throw new IOException("剪贴板为空");
                if(action.equals("readText")){JSObject result=new JSObject();result.put("value",String.valueOf(clip.getItemAt(0).coerceToText(getContext())));call.resolve(result);return;}
                Uri uri=clip.getItemAt(0).getUri();if(uri==null)throw new IOException("剪贴板中没有图片");String mime=getContext().getContentResolver().getType(uri);
                if(mime==null||!mime.matches("image/(png|jpeg|webp)"))throw new IOException("请复制 PNG、JPEG 或 WebP 图片");
                network.execute(()->{try(InputStream in=getContext().getContentResolver().openInputStream(uri);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>30*1024*1024)throw new IOException("剪贴板图片超过 30 MB");bytes.write(buffer,0,n);}JSObject result=new JSObject();result.put("mime",mime);result.put("data",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP));call.resolve(result);
                }catch(Exception e){call.reject(e.getMessage(),e);}});
            }catch(Exception e){call.reject(e.getMessage(),e);}
        });
    }
    @PluginMethod public void share(PluginCall call) {
      if("download".equals(call.getString("action"))&&Build.VERSION.SDK_INT<29){saveFile(call);return;}
      run(call,storage,()-> {
        File source=store.file(call.getString("path"),true);String mime=call.getString("mime","image/png"),action=call.getString("action");
        if(action.equals("copy")) {
            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",source);
            CompletableFuture<Void> copied=new CompletableFuture<>();getActivity().runOnUiThread(()->{try{((ClipboardManager)getContext().getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newUri(getContext().getContentResolver(),"图片",uri));copied.complete(null);}catch(Exception e){copied.completeExceptionally(e);}});copied.get(30,TimeUnit.SECONDS);
        } else {
            ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,call.getString("filename","NAI-Atelier.png"));values.put(MediaStore.MediaColumns.MIME_TYPE,mime);
            if(Build.VERSION.SDK_INT>=29){values.put(MediaStore.MediaColumns.RELATIVE_PATH,"Pictures/NAI Atelier");values.put(MediaStore.MediaColumns.IS_PENDING,1);}
            Uri uri=getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new IOException("无法保存到相册");
            try(InputStream input=new FileInputStream(source);OutputStream out=getContext().getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("相册写入失败");byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)out.write(buffer,0,n);}
            catch(Exception e){getContext().getContentResolver().delete(uri,null,null);throw e;}
            if(Build.VERSION.SDK_INT>=29){values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0);getContext().getContentResolver().update(uri,values,null,null);}
        }return new JSObject();
    });}
}
