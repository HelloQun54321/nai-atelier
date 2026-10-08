package io.github.helloqun54321.naiatelier;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.sqlite.*;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;
import com.getcapacitor.JSObject;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import java.util.zip.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** 备份流写入手机系统目录；资料和凭据一起由用户密码加密，缓存不参与。 */
final class AtelierBackup {
    static final byte[] HEADER="NAIATELIER2".getBytes(StandardCharsets.US_ASCII);
    static SecretKey key(String password,byte[] salt) throws Exception {
        if(password.length()<8)throw new IOException("备份密码至少 8 位");
        PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,150000,256);
        byte[] key=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();spec.clearPassword();
        SecretKey result=new SecretKeySpec(key,"AES");Arrays.fill(key,(byte)0);return result;
    }
    static byte[] frame(int mode,SecretKey key,byte[] seed,int index,byte[] data,int length) throws Exception {
        if(index<0)throw new IOException("备份分块数量超过上限");byte[] iv=seed.clone();java.nio.ByteBuffer.wrap(iv,8,4).putInt(index);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(mode,key,new GCMParameterSpec(128,iv));cipher.updateAAD(java.nio.ByteBuffer.allocate(8).putInt(index).putInt(length).array());return cipher.doFinal(data);
    }
    // Android AEAD 实现可能缓冲整条消息；64 KB 独立认证块让多 GB 原图备份保持固定内存。
    static OutputStream encrypted(OutputStream output,SecretKey key,byte[] seed) {
        return new FilterOutputStream(output){final byte[] buffer=new byte[65536];int size=0,index=0;
            void emit(int length)throws IOException{try{byte[] data=frame(Cipher.ENCRYPT_MODE,key,seed,index++,Arrays.copyOf(buffer,length),length);new DataOutputStream(out).writeInt(data.length);out.write(data);}catch(Exception e){throw new IOException("备份加密失败",e);}}
            @Override public void write(int value)throws IOException{buffer[size++]=(byte)value;if(size==buffer.length){emit(size);size=0;}}
            @Override public void write(byte[] data,int offset,int length)throws IOException{while(length>0){int n=Math.min(buffer.length-size,length);System.arraycopy(data,offset,buffer,size,n);size+=n;offset+=n;length-=n;if(size==buffer.length){emit(size);size=0;}}}
            @Override public void close()throws IOException{if(size>0)emit(size);emit(0);out.close();}
        };
    }
    static void decrypt(InputStream input,OutputStream output,SecretKey key,byte[] seed)throws Exception{
        DataInputStream source=new DataInputStream(input);int index=0;
        for(;;){int size=source.readInt();if(size<16||size>65552)throw new IOException("备份认证块大小无效");byte[] data=new byte[size];source.readFully(data);byte[] plain=frame(Cipher.DECRYPT_MODE,key,seed,index++,data,size-16);if(size==16){if(source.read()!=-1)throw new IOException("备份尾部存在额外内容");return;}output.write(plain);}
    }
    static void copy(InputStream input,OutputStream output) throws IOException {byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
    static String text(Path path) throws IOException{return new String(Files.readAllBytes(path),StandardCharsets.UTF_8);}
    static File marker(Context context){return new File(context.getFilesDir(),"atelier-restore.json");}
    static void restorePreferences(Context context,JSONObject recovery)throws Exception{
        SharedPreferences.Editor edit=context.getSharedPreferences("atelier-secrets",Context.MODE_PRIVATE).edit().clear();JSONObject values=recovery.getJSONObject("secrets");for(Iterator<String> keys=values.keys();keys.hasNext();){String key=keys.next();edit.putString(key,values.getString(key));}if(!edit.commit())throw new IOException("恢复旧凭据失败");
        SharedPreferences.Editor model=context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).edit();String value=recovery.optString("model","");if(value.isEmpty())model.remove("model");else model.putString("model",value);if(!model.commit())throw new IOException("恢复旧模型设置失败");
    }
    // 恢复在用户确认之后执行；若进程在替换途中被系统结束，下次启动还原原来的完整工坊。
    static void recover(Context context)throws Exception{
        File marker=marker(context);if(!marker.isFile())return;JSONObject recovery=new JSONObject(text(marker.toPath()));String id=recovery.getString("id");if(!id.matches("[0-9a-f-]{36}"))throw new IOException("恢复记录无效");File previous=new File(context.getFilesDir(),"atelier-previous-"+id),root=new File(context.getFilesDir(),"atelier");
        if(previous.isDirectory()){delete(root);Files.move(previous.toPath(),root.toPath(),StandardCopyOption.ATOMIC_MOVE);}
        restorePreferences(context,recovery);Files.delete(marker.toPath());
    }
    static void entry(ZipOutputStream zip,String name,byte[] bytes) throws Exception {zip.putNextEntry(new ZipEntry(name));zip.write(bytes);zip.closeEntry();}
    static File export(Context context,AtelierStore store,String password,JSONObject preferences) throws Exception {
        File snapshot=store.file("backup/"+UUID.randomUUID()+".sqlite",true),archive=store.file("backup/"+UUID.randomUUID()+".naiatelier",true);snapshot.getParentFile().mkdirs();
        try {
            store.query("VACUUM INTO ?",new JSONArray().put(snapshot.getPath()));
            byte[] salt=new byte[16],iv=new byte[12];SecureRandom random=new SecureRandom();random.nextBytes(salt);random.nextBytes(iv);
            try(OutputStream raw=new FileOutputStream(archive)){
                raw.write(HEADER);raw.write(salt);raw.write(iv);
                try(ZipOutputStream zip=new ZipOutputStream(encrypted(raw,key(password,salt),iv))){
                    entry(zip,"manifest.json",new JSONObject().put("format",1).put("createdAt",System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8));
                    entry(zip,"preferences.json",preferences.toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject secrets=new JSONObject();for(Map.Entry<String,?> item:context.getSharedPreferences("atelier-secrets",Context.MODE_PRIVATE).getAll().entrySet())secrets.put(item.getKey(),store.unseal(String.valueOf(item.getValue())));
                    JSONArray vault=store.query("SELECT value FROM settings WHERE key='nai_key_vault'",new JSONArray()).getJSONArray("results");
                    if(vault.length()>0)secrets.put("__nai_key_vault",vault.getJSONObject(0).getString("value"));
                    secrets.put("__tagger_model",context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).getString("model",""));
                    entry(zip,"secrets.json",secrets.toString().getBytes(StandardCharsets.UTF_8));
                    zip.putNextEntry(new ZipEntry("data/atelier.sqlite"));try(InputStream input=new FileInputStream(snapshot)){copy(input,zip);}zip.closeEntry();
                    try(java.util.stream.Stream<Path> files=Files.walk(store.root.toPath())){
                        for(Path path:(Iterable<Path>)files.filter(Files::isRegularFile)::iterator){String name=store.root.toPath().relativize(path).toString().replace('\\','/');if(name.startsWith("atelier.sqlite"))continue;
                            zip.putNextEntry(new ZipEntry("data/"+name));
                            if(name.endsWith(".key"))zip.write(store.unseal(text(path)).getBytes(StandardCharsets.UTF_8));else try(InputStream input=Files.newInputStream(path)){copy(input,zip);}zip.closeEntry();
                        }
                    }
                }
            }
            return archive;
        } catch(Exception e){Files.deleteIfExists(archive.toPath());throw e;}finally{Files.deleteIfExists(snapshot.toPath());}
    }
    static JSObject inspect(InputStream input,Context context,AtelierStore store,String password) throws Exception {
        String id=UUID.randomUUID().toString();File directory=store.file("restore/"+id,true),zipFile=store.file("restore/"+id+".zip",true);directory.mkdirs();
        try {
            byte[] header=new byte[HEADER.length],salt=new byte[16],iv=new byte[12];DataInputStream headerInput=new DataInputStream(input);headerInput.readFully(header);headerInput.readFully(salt);headerInput.readFully(iv);if(!Arrays.equals(header,HEADER))throw new IOException("不是 NAI Atelier 手机备份");
            // 先读完并验证 GCM 标签，再解压；错误密码和被修改的备份不能进入替换阶段。
            try(OutputStream output=new FileOutputStream(zipFile)){decrypt(input,output,key(password,salt),iv);}
            long total=0;int count=0;
            try(ZipInputStream zip=new ZipInputStream(new FileInputStream(zipFile))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){String name=entry.getName();if(entry.isDirectory())continue;
                if(++count>100000||name.startsWith("/")||name.contains("\\")||Arrays.asList(name.split("/")).contains("..")||!name.matches("(?:data/.+|manifest\\.json|preferences\\.json|secrets\\.json)"))throw new IOException("备份含越界或未知文件");
                File target=new File(directory,name).getCanonicalFile();if(!target.getPath().startsWith(directory.getCanonicalPath()+File.separator)||target.exists())throw new IOException("备份文件越界或重复");target.getParentFile().mkdirs();
                try(OutputStream out=new FileOutputStream(target)){byte[] buffer=new byte[65536];int n;while((n=zip.read(buffer))!=-1){total+=n;if(total>50L*1024*1024*1024)throw new IOException("备份展开超过 50 GB");out.write(buffer,0,n);}}
            }}
            JSONObject manifest=new JSONObject(text(new File(directory,"manifest.json").toPath()));if(manifest.getInt("format")!=1)throw new IOException("不支持的备份版本");
            new JSONObject(text(new File(directory,"preferences.json").toPath()));new JSONObject(text(new File(directory,"secrets.json").toPath()));
            try(SQLiteConnection db=new BundledSQLiteDriver().open(new File(directory,"data/atelier.sqlite").getPath());SQLiteStatement check=db.prepare("PRAGMA integrity_check");SQLiteStatement objects=db.prepare("SELECT hash FROM mobile_objects")){
                if(!check.step()||!check.getText(0).equals("ok"))throw new IOException("备份数据库校验失败");
                Set<String> checked=new HashSet<>();while(objects.step()){String hash=objects.getText(0);if(!hash.matches("[0-9a-f]{64}"))throw new IOException("备份图片索引无效");if(checked.add(hash)){File original=new File(directory,"data/objects/"+hash);if(!original.isFile()||!AtelierStore.hash(original).equals(hash))throw new IOException("备份原图缺失或内容被修改");}}
            }
            JSObject result=new JSObject();result.put("id",id);result.put("bytes",total);result.put("files",count);result.put("createdAt",manifest.getLong("createdAt"));return result;
        } catch(Exception e){delete(directory);throw e;}finally{Files.deleteIfExists(zipFile.toPath());}
    }
    static AtelierStore restore(Context context,AtelierStore old,String id) throws Exception {
        if(!id.matches("[0-9a-f-]{36}"))throw new IOException("备份恢复凭据无效");
        File stage=old.file("restore/"+id,true),data=new File(stage,"data"),previous=new File(context.getFilesDir(),"atelier-previous-"+id);
        if(!data.isDirectory())throw new IOException("请重新选择并验证备份文件");
        JSONObject secrets=new JSONObject(text(new File(stage,"secrets.json").toPath()));
        SharedPreferences prefs=context.getSharedPreferences("atelier-secrets",Context.MODE_PRIVATE);Map<String,?> oldSecrets=prefs.getAll();
        JSONObject recovery=new JSONObject().put("id",id).put("secrets",new JSONObject(oldSecrets)).put("model",context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).getString("model",""));
        File temporary=new File(context.getFilesDir(),"atelier-restore.tmp");try(FileOutputStream record=new FileOutputStream(temporary)){record.write(recovery.toString().getBytes(StandardCharsets.UTF_8));record.getFD().sync();}Files.move(temporary.toPath(),marker(context).toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        old.close();AtelierStore restored=null;
        try {
            Files.move(old.root.toPath(),previous.toPath(),StandardCopyOption.ATOMIC_MOVE);
            Files.move(data.toPath(),old.root.toPath(),StandardCopyOption.ATOMIC_MOVE);
            restored=new AtelierStore(context,false);
            if(secrets.has("__nai_key_vault")){String vault=secrets.getString("__nai_key_vault");new JSONArray(vault);restored.query("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)",new JSONArray().put("nai_key_vault").put(vault));}
            try(java.util.stream.Stream<Path> files=Files.walk(restored.root.toPath())){for(Path path:(Iterable<Path>)files.filter(p->p.toString().endsWith(".key"))::iterator)Files.write(path,restored.seal(text(path)).getBytes(StandardCharsets.UTF_8));}
            SharedPreferences.Editor edit=prefs.edit().clear();for(Iterator<String> names=secrets.keys();names.hasNext();){String name=names.next();if(!name.startsWith("__"))edit.putString(name,restored.seal(secrets.getString(name)));}if(!edit.commit())throw new IOException("恢复凭据保存失败");
            String selectedModel=secrets.optString("__tagger_model","");SharedPreferences.Editor model=context.getSharedPreferences("atelier-tagger",Context.MODE_PRIVATE).edit();if(selectedModel.isEmpty())model.remove("model");else model.putString("model",selectedModel);if(!model.commit())throw new IOException("模型设置恢复失败");
            Files.delete(marker(context).toPath());
        }catch(Exception e){if(restored!=null)restored.close();recover(context);throw e;}
        // 新事实源和凭据均已提交；清理本次暂存文件不影响成功收据。
        try{delete(previous);delete(stage);}catch(IOException ignored){}return restored;
    }
    static void delete(File root) throws IOException {if(!root.exists())return;try(java.util.stream.Stream<Path> files=Files.walk(root.toPath())){for(Path file:(Iterable<Path>)files.sorted(Comparator.reverseOrder())::iterator)Files.delete(file);}}
}
