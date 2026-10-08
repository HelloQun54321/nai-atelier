package io.github.helloqun54321.naiatelier;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.sqlite.SQLiteConnection;
import androidx.sqlite.SQLiteStatement;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** 手机事实源与缓存分开；仅接收应用私有目录中的相对路径。 */
final class AtelierStore implements AutoCloseable {
    final File root;
    final File cache;
    final SQLiteConnection db;
    private final SecretKey key;

    AtelierStore(Context context) throws Exception {this(context,true);}
    AtelierStore(Context context,boolean recover) throws Exception {
        if(recover)AtelierBackup.recover(context);
        root = new File(context.getFilesDir(), "atelier");
        cache = new File(context.getCacheDir(), "atelier");
        if ((!root.exists() && !root.mkdirs()) || (!cache.exists() && !cache.mkdirs())) throw new IOException("无法创建手机工坊目录");
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (!keys.containsAlias("atelier")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("atelier", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        key = (SecretKey) keys.getKey("atelier", null);
        db = new BundledSQLiteDriver().open(new File(root, "atelier.sqlite").getPath());
        query("PRAGMA journal_mode=WAL", new JSONArray());
        query("PRAGMA busy_timeout=5000", new JSONArray());
        query("CREATE TABLE IF NOT EXISTS mobile_objects (key TEXT PRIMARY KEY, hash TEXT NOT NULL, mime TEXT NOT NULL)", new JSONArray());
    }
    File file(String path, boolean cached) throws IOException {
        File base = cached ? cache : root;
        File result = new File(base, path).getCanonicalFile();
        if (path == null || path.isEmpty() || path.startsWith("/") || !result.getPath().startsWith(base.getCanonicalPath() + File.separator)) throw new IOException("文件路径越界");
        return result;
    }
    String seal(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key);
        return "keystore:" + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }
    String unseal(String value) throws Exception {
        if (!value.startsWith("keystore:")) return value;
        String[] parts = value.split(":", 3);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(parts[1], Base64.DEFAULT)));
        return new String(cipher.doFinal(Base64.decode(parts[2], Base64.DEFAULT)), StandardCharsets.UTF_8);
    }
    synchronized JSObject query(String sql, JSONArray values) throws Exception {
        SQLiteStatement statement = db.prepare(sql);
        try {
            for (int i = 0; i < values.length(); i++) {
                Object value = values.get(i);
                // Key 库仍由原 Worker 管理，持久值在原生层加密。
                if (value instanceof String && values.toString().contains("\"nai_key_vault\"") && ((String)value).startsWith("[")) value = seal((String)value);
                if (value == JSONObject.NULL) statement.bindNull(i + 1);
                else if (value instanceof Float || value instanceof Double) statement.bindDouble(i + 1, ((Number)value).doubleValue());
                else if (value instanceof Number) statement.bindLong(i + 1, ((Number)value).longValue());
                else if (value instanceof Boolean) statement.bindLong(i + 1, (Boolean)value ? 1 : 0);
                else statement.bindText(i + 1, String.valueOf(value));
            }
            JSArray rows = new JSArray();
            while (statement.step()) {
                JSObject row = new JSObject();
                for (int col = 0; col < statement.getColumnCount(); col++) {
                    Object value;
                    switch (statement.getColumnType(col)) {
                        case 1: value = statement.getLong(col); break;
                        case 2: value = statement.getDouble(col); break;
                        case 3: value = unseal(statement.getText(col)); break;
                        case 4: value = Base64.encodeToString(statement.getBlob(col), Base64.NO_WRAP); break;
                        default: value = JSONObject.NULL;
                    }
                    row.put(statement.getColumnName(col), value);
                }
                rows.put(row);
            }
            JSObject result = new JSObject(); result.put("results", rows); result.put("success", true);
            result.put("meta", new JSObject()); return result;
        } finally { statement.close(); }
    }
    synchronized JSArray batch(JSONArray statements) throws Exception {
        query("BEGIN IMMEDIATE", new JSONArray());
        try {
            JSArray results = new JSArray();
            for (int i=0; i<statements.length(); i++) { JSONObject s = statements.getJSONObject(i); results.put(query(s.getString("sql"), s.optJSONArray("values") == null ? new JSONArray() : s.getJSONArray("values"))); }
            query("COMMIT", new JSONArray()); return results;
        } catch (Exception e) { query("ROLLBACK", new JSONArray()); throw e; }
    }
    static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int n; while ((n=input.read(buffer)) != -1) digest.update(buffer,0,n); }
        StringBuilder result = new StringBuilder(); for (byte b : digest.digest()) result.append(String.format("%02x", b & 255)); return result.toString();
    }
    synchronized JSObject putObject(String name, String temporary, String mime) throws Exception {
        if (name.isEmpty() || name.length() > 1024) throw new IOException("图片键无效");
        File source = file(temporary,true); String hash = hash(source);
        File target = file("objects/" + hash,false); target.getParentFile().mkdirs();
        if (!target.exists()) Files.move(source.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);
        else Files.delete(source.toPath());
        query("INSERT OR REPLACE INTO mobile_objects (key,hash,mime) VALUES (?,?,?)", new JSONArray().put(name).put(hash).put(mime));
        return object(name);
    }
    synchronized JSObject object(String name) throws Exception {
        JSONArray rows = query("SELECT hash,mime FROM mobile_objects WHERE key=?",new JSONArray().put(name)).getJSONArray("results");
        JSObject result = new JSObject(); if (rows.length()==0) { result.put("missing",true); return result; }
        JSONObject row = rows.getJSONObject(0); File value = file("objects/" + row.getString("hash"),false);
        if (!value.isFile()) throw new IOException("原图文件缺失，不能以缓存冒充原件");
        result.put("path",value.getPath()); result.put("mime",row.getString("mime")); result.put("hash",row.getString("hash")); return result;
    }
    synchronized void deleteObject(String name) throws Exception {
        JSObject old = object(name);
        query("DELETE FROM mobile_objects WHERE key=?",new JSONArray().put(name));
        if (!old.optBoolean("missing") && query("SELECT 1 FROM mobile_objects WHERE hash=?",new JSONArray().put(old.getString("hash"))).getJSONArray("results").length()==0) Files.deleteIfExists(file("objects/"+old.getString("hash"),false).toPath());
    }
    @Override public synchronized void close() { db.close(); }
}
