package io.github.helloqun54321.naiatelier;

import android.content.Context;
import android.graphics.*;
import android.util.Base64;
import androidx.exifinterface.media.ExifInterface;
import ai.onnxruntime.*;
import com.getcapacitor.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.FloatBuffer;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** 清单由共用 imageTaggerModels.mjs 构建生成，不随 APK 携带模型。 */
final class AtelierTagger {
    private final AtelierStore store;
    private final JSONArray models;
    private final Context context;
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile String downloading=null,stage="missing",error="";
    private volatile boolean pause=false;
    private volatile boolean downloadingActive=false;
    private OrtSession session;
    private String loaded="";
    AtelierTagger(Context context,AtelierStore store) throws Exception {
        this.context=context;this.store=store;
        try(InputStream input=context.getAssets().open("tagger-models.json");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){AtelierBackup.copy(input,bytes);models=new JSONArray(bytes.toString("UTF-8"));}
    }
    JSONObject model(String id) throws Exception {for(int i=0;i<models.length();i++){JSONObject m=models.getJSONObject(i);if(m.getString("id").equals(id))return m;}throw new IOException("未知反推模型");}
    File directory(JSONObject m) throws Exception {return store.file("models/"+m.getString("directory"),true);}
    boolean ready(JSONObject m) throws Exception {
        File dir=directory(m);JSONArray files=m.getJSONArray("files");
        for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);if(new File(dir,f.getString("name")).length()!=f.getLong("size"))return false;}
        return new File(dir,"verified").isFile();
    }
    JSObject status() throws Exception {
        String selected=context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).getString("model",models.getJSONObject(0).getString("id"));
        JSObject result=new JSObject();JSArray states=new JSArray();
        for(int i=0;i<models.length();i++){
            JSONObject m=models.getJSONObject(i);JSObject s=JSObject.fromJSONObject(m);long total=0,received=0;File dir=directory(m);JSONArray files=m.getJSONArray("files");
            for(int j=0;j<files.length();j++){JSONObject f=files.getJSONObject(j);total+=f.getLong("size");File done=new File(dir,f.getString("name"));received+=done.isFile()?done.length():new File(dir,f.getString("name")+".part").length();}
            boolean ready=ready(m);s.put("downloaded",ready);s.put("totalBytes",total);s.put("receivedBytes",received);
            s.put("stage",m.getString("id").equals(downloading)?stage:ready?"ready":received>0?"paused":"missing");s.put("error",m.getString("id").equals(downloading)?error:"");states.put(s);
        }
        result.put("model",selected);result.put("downloaded",ready(model(selected)));result.put("models",states);result.put("busy",busy.get());result.put("downloadingModel",downloading==null?JSONObject.NULL:downloading);return result;
    }
    JSObject handle(PluginCall call) throws Exception {
        String action=call.getString("action","status");String selected=call.getString("model",context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).getString("model",models.getJSONObject(0).getString("id")));
        if(action.equals("status"))return status();
        if(action.equals("pause")){pause=true;return status();}
        JSONObject m=model(selected);
        if(action.equals("model")){if(!context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).edit().putString("model",selected).commit())throw new IOException("模型选择保存失败");return status();}
        if(action.equals("download")){
            synchronized(this){if(downloadingActive)throw new IOException("已有模型正在下载");pause=false;downloading=selected;downloadingActive=true;stage="downloading";error="";}
            new Thread(()->{try{download(m);stage=pause?"paused":"ready";}catch(Exception e){stage="error";error=e.getMessage();}finally{downloadingActive=false;if(!stage.equals("error"))downloading=null;}},"atelier-model-download").start();return status();
        }
        if(action.equals("delete")){
            synchronized(this){if(busy.get()||downloadingActive&&selected.equals(downloading))throw new IOException("模型正在使用，请先停止下载或识别");if(loaded.equals(selected)){session.close();session=null;loaded="";}}
            File dir=directory(m);File[] entries=dir.listFiles();if(entries!=null)for(File f:entries)Files.delete(f.toPath());Files.deleteIfExists(dir.toPath());return status();
        }
        if(!action.equals("infer"))throw new IOException("未知反推操作");
        if(!ready(m))throw new IOException("请先在设置下载反推模型");
        if(!busy.compareAndSet(false,true))throw new IOException("已有图片正在识别");
        try{return infer(m,Base64.decode(call.getString("data"),Base64.DEFAULT),call.getDouble("threshold",m.getDouble("threshold")),call.getDouble("characterThreshold",m.getDouble("characterThreshold")));}
        finally{busy.set(false);}
    }
    void download(JSONObject m) throws Exception {
        File dir=directory(m);if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("无法创建模型缓存");JSONArray files=m.getJSONArray("files");
        for(int i=0;i<files.length()&&!pause;i++){
            JSONObject f=files.getJSONObject(i);File target=new File(dir,f.getString("name"));
            if(target.length()==f.getLong("size")&&AtelierStore.hash(target).equals(f.getString("sha256")))continue;
            File part=new File(dir,f.getString("name")+".part");long offset=part.length();
            HttpURLConnection connection=(HttpURLConnection)new URL("https://huggingface.co/"+m.getString("id")+"/resolve/"+m.getString("revision")+"/"+f.getString("name")).openConnection();
            connection.setConnectTimeout(30000);connection.setReadTimeout(30000);if(offset>0)connection.setRequestProperty("Range","bytes="+offset+"-");
            try{
                int code=connection.getResponseCode();if(code!=200&&code!=206)throw new IOException("模型下载 HTTP "+code);
                boolean append=offset>0&&code==206;
                if(append&&!connection.getHeaderField("Content-Range").startsWith("bytes "+offset+"-"))throw new IOException("模型续传位置不一致");
                long size=append?offset:0;
                try(InputStream in=connection.getInputStream();OutputStream out=new FileOutputStream(part,append)){byte[] buffer=new byte[65536];int n;while(!pause&&(n=in.read(buffer))!=-1){size+=n;if(size>f.getLong("size"))throw new IOException("模型下载超过清单大小");out.write(buffer,0,n);}}
                if(pause)break;stage="verifying";
                if(part.length()!=f.getLong("size")||!AtelierStore.hash(part).equals(f.getString("sha256")))throw new IOException("模型完整性校验失败，请删除后重新下载");
                Files.move(part.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);stage="downloading";
            }finally{connection.disconnect();}
        }
        if(!pause)Files.write(new File(dir,"verified").toPath(),"verified".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    JSObject infer(JSONObject m,byte[] bytes,double threshold,double characterThreshold) throws Exception {
        if(bytes.length>30*1024*1024)throw new IOException("图片超过 30 MB");
        if(!Double.isFinite(threshold)||!Double.isFinite(characterThreshold)||threshold<0||threshold>1||characterThreshold<0||characterThreshold>1)throw new IOException("识别阈值无效");
        OrtEnvironment env=OrtEnvironment.getEnvironment();
        if(session==null||!loaded.equals(m.getString("id"))){if(session!=null)session.close();try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()){options.setIntraOpNumThreads(Math.min(4,Runtime.getRuntime().availableProcessors()));session=env.createSession(new File(directory(m),"model.onnx").getPath(),options);}loaded=m.getString("id");}
        String inputName=session.getInputNames().iterator().next();long[] shape=((TensorInfo)session.getInputInfo().get(inputName).getInfo()).getShape();int side=shape.length==4&&shape[1]>0?(int)shape[1]:448;
        BitmapFactory.Options decode=new BitmapFactory.Options();decode.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,decode);if(decode.outWidth<=0||decode.outHeight<=0)throw new IOException("无法读取图片");
        decode.inSampleSize=Math.max(1,Math.max(decode.outWidth,decode.outHeight)/side);decode.inJustDecodeBounds=false;Bitmap source=BitmapFactory.decodeByteArray(bytes,0,bytes.length,decode);
        ExifInterface exif=new ExifInterface(new ByteArrayInputStream(bytes));Matrix rotation=new Matrix();rotation.postRotate(exif.getRotationDegrees());if(exif.isFlipped())rotation.postScale(-1,1);
        if(!rotation.isIdentity()){Bitmap oriented=Bitmap.createBitmap(source,0,0,source.getWidth(),source.getHeight(),rotation,true);if(oriented!=source)source.recycle();source=oriented;}
        Bitmap canvas=Bitmap.createBitmap(side,side,Bitmap.Config.ARGB_8888);Canvas painter=new Canvas(canvas);painter.drawColor(Color.WHITE);float scale=(float)side/Math.max(source.getWidth(),source.getHeight());float w=source.getWidth()*scale,h=source.getHeight()*scale;
        painter.drawBitmap(source,null,new RectF((side-w)/2,(side-h)/2,(side+w)/2,(side+h)/2),new Paint(Paint.FILTER_BITMAP_FLAG));source.recycle();
        int[] pixels=new int[side*side];canvas.getPixels(pixels,0,side,0,0,side,side);canvas.recycle();float[] input=new float[pixels.length*3];for(int i=0;i<pixels.length;i++){input[i*3]=pixels[i]&255;input[i*3+1]=(pixels[i]>>8)&255;input[i*3+2]=(pixels[i]>>16)&255;}
        float[] scores;try(OnnxTensor tensor=OnnxTensor.createTensor(env,FloatBuffer.wrap(input),new long[]{1,side,side,3});OrtSession.Result output=session.run(Collections.singletonMap(inputName,tensor))){scores=((float[][])output.get(0).getValue())[0];}
        List<String> lines=Files.readAllLines(new File(directory(m),"selected_tags.csv").toPath());if(lines.size()-1!=scores.length)throw new IOException("模型输出与词表长度不一致");
        List<JSObject> general=new ArrayList<>(),characters=new ArrayList<>();JSObject rating=null;
        for(int i=0;i<scores.length;i++){List<String> fields=csvLine(lines.get(i+1));String name=fields.get(1);int category=Integer.parseInt(fields.get(2));float confidence=scores[i];
            JSObject tag=new JSObject();tag.put("name",name);tag.put("confidence",confidence);tag.put("category",category==9?"rating":category==4?"character":"general");
            if(category==9){if(rating==null||confidence>rating.getDouble("confidence"))rating=tag;}else if(category==4&&confidence>=characterThreshold)characters.add(tag);else if(category==0&&confidence>=threshold)general.add(tag);
        }
        Comparator<JSObject> order=(a,b)->Double.compare(b.optDouble("confidence"),a.optDouble("confidence"));general.sort(order);characters.sort(order);
        JSArray all=new JSArray();for(JSObject tag:characters)all.put(tag);for(JSObject tag:general)all.put(tag);
        JSObject result=new JSObject();result.put("model",m.getString("id"));result.put("threshold",threshold);result.put("characterThreshold",characterThreshold);result.put("rating",rating==null?JSONObject.NULL:rating);result.put("general",new JSArray(general));result.put("character",new JSArray(characters));result.put("tags",all);return result;
    }
    static List<String> csvLine(String line) throws IOException {
        List<String> result=new ArrayList<>();StringBuilder field=new StringBuilder();boolean quoted=false;
        for(int i=0;i<line.length();i++){char c=line.charAt(i);if(c=='"'){if(quoted&&i+1<line.length()&&line.charAt(i+1)=='"'){field.append('"');i++;}else quoted=!quoted;}else if(c==','&&!quoted){result.add(field.toString());field.setLength(0);}else field.append(c);}
        if(quoted)throw new IOException("词表 CSV 引号不完整");result.add(field.toString());return result;
    }
}
