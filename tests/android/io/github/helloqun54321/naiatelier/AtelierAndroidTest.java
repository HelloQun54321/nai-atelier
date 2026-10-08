package io.github.helloqun54321.naiatelier;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AtelierAndroidTest {
    @Test public void browserGalleryOnlyUsesExistingPublicHttpsEndpoints(){
        for(String path:new String[]{"config?v=260528a","ai_works_search?page=1","rank/monthly/real","rank/monthly/fixed?month=2026-09","work/123"})assertTrue(AtelierBrowserRequest.allowed("https://aitag.win/api/"+path));
        for(String url:new String[]{"http://aitag.win/api/config","https://aitag.win:444/api/config","https://user@aitag.win/api/config","https://aitag.win/admin","https://localhost/api/config","https://aitag.win.evil.invalid/api/config","https://aitag.win/api/work/../config","https://aitag.win/api/config/other"})assertFalse(AtelierBrowserRequest.allowed(url));
    }
    Context context;File workspace;AtelierStore store;
    @Before public void start() throws Exception {
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();workspace=new File(target.getCacheDir(),"synthetic-test-"+UUID.randomUUID());
        context=new ContextWrapper(target){@Override public File getFilesDir(){File root=new File(workspace,"files");root.mkdirs();return root;}@Override public File getCacheDir(){File root=new File(workspace,"cache");root.mkdirs();return root;}@Override public android.content.SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(workspace.getName()+name,mode);}};
        store=new AtelierStore(context);
    }
    @After public void finish() throws Exception {store.close();for(String name:new String[]{"atelier-secrets","atelier-tagger"})context.deleteSharedPreferences(workspace.getName()+name);AtelierBackup.delete(workspace);}
    @Test public void sqliteJsonTransactionsAndCredentials()throws Exception{
        store.query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)",new JSONArray());
        store.query("INSERT INTO settings VALUES (?,?)",new JSONArray().put("nai_key_vault").put("[{\"key\":\"synthetic-only\"}]"));
        assertEquals("[{\"key\":\"synthetic-only\"}]",store.query("SELECT value FROM settings WHERE key=?",new JSONArray().put("nai_key_vault")).getJSONArray("results").getJSONObject(0).getString("value"));
        assertEquals(2,store.query("SELECT json_array_length('[1,2]') AS count",new JSONArray()).getJSONArray("results").getJSONObject(0).getInt("count"));
        try{store.batch(new JSONArray().put(new JSONObject().put("sql","INSERT INTO settings VALUES ('rollback','x')")).put(new JSONObject().put("sql","INVALID SQL")));fail("事务错误必须失败");}catch(Exception expected){}
        assertEquals(0,store.query("SELECT key FROM settings WHERE key='rollback'",new JSONArray()).getJSONArray("results").length());
        try{store.file("../outside",false);fail("不能访问保护目录之外的文件");}catch(IOException expected){}
    }
    @Test public void contentAddressedObjectsKeepIndependentReferences()throws Exception{
        for(String id:new String[]{"a","b"}){File temporary=store.file("transfer/"+id,true);temporary.getParentFile().mkdirs();Files.write(temporary.toPath(),new byte[]{1,2,3});store.putObject(id,"transfer/"+id,"image/png");}
        assertEquals(store.object("a").getString("path"),store.object("b").getString("path"));
        String path=store.object("b").getString("path");store.deleteObject("a");assertTrue(new File(path).isFile());store.deleteObject("b");assertFalse(new File(path).exists());
    }
    @Test public void authenticatedBackupStreamsAndRejectsTampering()throws Exception{
        byte[] plain=new byte[200000];new Random(1).nextBytes(plain);byte[] salt=new byte[16],iv=new byte[12];javax.crypto.SecretKey key=AtelierBackup.key("synthetic-password",salt);
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(OutputStream out=AtelierBackup.encrypted(bytes,key,iv)){out.write(plain);}byte[] encrypted=bytes.toByteArray();
        ByteArrayOutputStream decoded=new ByteArrayOutputStream();AtelierBackup.decrypt(new ByteArrayInputStream(encrypted),decoded,key,iv);assertArrayEquals(plain,decoded.toByteArray());
        for(byte[] invalid:new byte[][]{Arrays.copyOf(encrypted,encrypted.length-1),Arrays.copyOf(encrypted,encrypted.length+1)}){try{AtelierBackup.decrypt(new ByteArrayInputStream(invalid),new ByteArrayOutputStream(),key,iv);fail("截断与追加内容必须失败");}catch(Exception expected){}}
        encrypted[100]^=1;try{AtelierBackup.decrypt(new ByteArrayInputStream(encrypted),new ByteArrayOutputStream(),key,iv);fail("认证必须拒绝被修改的内容");}catch(Exception expected){}
    }
    @Test public void backupRestoresOriginalsAndReencryptsKeyVault()throws Exception{
        store.query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)",new JSONArray());
        store.query("INSERT INTO settings VALUES (?,?)",new JSONArray().put("nai_key_vault").put("[{\"key\":\"synthetic-backup\"}]"));
        File temporary=store.file("transfer/image",true);temporary.getParentFile().mkdirs();Files.write(temporary.toPath(),new byte[]{4,5,6});store.putObject("image","transfer/image","image/png");
        File exported=AtelierBackup.export(context,store,"synthetic-password",new JSONObject().put("theme","dark"));
        JSONObject result;try(InputStream input=new FileInputStream(exported)){result=AtelierBackup.inspect(input,context,store,"synthetic-password");}
        store.deleteObject("image");store=AtelierBackup.restore(context,store,result.getString("id"));
        assertArrayEquals(new byte[]{4,5,6},Files.readAllBytes(new File(store.object("image").getString("path")).toPath()));
        assertEquals("[{\"key\":\"synthetic-backup\"}]",store.query("SELECT value FROM settings WHERE key='nai_key_vault'",new JSONArray()).getJSONArray("results").getJSONObject(0).getString("value"));
    }
    @Test public void tagCsvPreservesQuotedNames()throws Exception{assertEquals(Arrays.asList("1","name, with \"quotes\"","4","10"),AtelierTagger.csvLine("1,\"name, with \"\"quotes\"\"\",4,10"));}
    @Test public void publicWebRejectsReservedNetworks()throws Exception{
        for(String ip:new String[]{"127.0.0.1","100.64.0.1","192.0.2.1","198.18.0.1","::1","fc00::1","2001:db8::1","::ffff:127.0.0.1"})assertFalse(ip,AtelierPlugin.publicAddress(java.net.InetAddress.getByName(ip)));
        assertTrue(AtelierPlugin.publicAddress(java.net.InetAddress.getByName("1.1.1.1")));
    }
    @Test public void interruptedRestoreReturnsOriginalWorkshop()throws Exception{
        store.query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)",new JSONArray());store.query("INSERT INTO settings VALUES ('retained','synthetic')",new JSONArray());
        String id=UUID.randomUUID().toString();Files.write(AtelierBackup.marker(context).toPath(),new JSONObject().put("id",id).put("secrets",new JSONObject()).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));store.close();Files.move(store.root.toPath(),new File(context.getFilesDir(),"atelier-previous-"+id).toPath());store.root.mkdirs();Files.write(new File(store.root,"incomplete").toPath(),new byte[]{1});store=new AtelierStore(context);
        assertEquals("synthetic",store.query("SELECT value FROM settings WHERE key='retained'",new JSONArray()).getJSONArray("results").getJSONObject(0).getString("value"));assertFalse(AtelierBackup.marker(context).exists());assertFalse(new File(store.root,"incomplete").exists());
    }
    @Test public void onnxCpuInferenceUsesSyntheticModelWithoutDownload()throws Exception{
        AtelierTagger tagger=new AtelierTagger(context,store);java.lang.reflect.Field models=AtelierTagger.class.getDeclaredField("models");models.setAccessible(true);JSONObject model=((JSONArray)models.get(tagger)).getJSONObject(0);File dir=tagger.directory(model);dir.mkdirs();
        byte[] fixture=android.util.Base64.decode("CAgSCE5BSSB0ZXN0OoYBCjwSBnNjb3JlcyIIQ29uc3RhbnQqKAoFdmFsdWUqHAgBCAMQAUIGc2NvcmVzSgxmZmY/zcxMP83MTD6gAQQSCXN5bnRoZXRpY1ohCgVpbWFnZRIYChYIARISCgIIAQoDCMADCgMIwAMKAggDYhgKBnNjb3JlcxIOCgwIARIICgIIAQoCCANCAhAN",android.util.Base64.DEFAULT);
        Files.write(new File(dir,"model.onnx").toPath(),fixture);Files.write(new File(dir,"selected_tags.csv").toPath(),"tag_id,name,category,count\n1,safe,9,1\n2,synthetic_character,4,1\n3,low_score,0,1\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        android.graphics.Bitmap image=android.graphics.Bitmap.createBitmap(2,2,android.graphics.Bitmap.Config.ARGB_8888);ByteArrayOutputStream png=new ByteArrayOutputStream();image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,png);image.recycle();
        try{com.getcapacitor.JSObject result=tagger.infer(model,png.toByteArray(),0.35,0.75);assertEquals("safe",result.getJSONObject("rating").getString("name"));assertEquals("synthetic_character",result.getJSONArray("character").getJSONObject(0).getString("name"));assertEquals(0,result.getJSONArray("general").length());}
        finally{java.lang.reflect.Field field=AtelierTagger.class.getDeclaredField("session");field.setAccessible(true);ai.onnxruntime.OrtSession session=(ai.onnxruntime.OrtSession)field.get(tagger);if(session!=null)session.close();}
    }
}
