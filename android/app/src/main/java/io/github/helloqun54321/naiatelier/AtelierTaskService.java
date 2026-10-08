package io.github.helloqun54321.naiatelier;

import android.app.*;
import android.content.*;
import android.os.*;

/** 仅在生成或助手请求期间保留任务；启动工坊和浏览图库不启用常驻服务。 */
public class AtelierTaskService extends Service {
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel("atelier-task","创作任务",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(7,new Notification.Builder(this,"atelier-task").setSmallIcon(R.drawable.ic_stat_work).setContentTitle("NAI Atelier").setContentText("生成或助手任务正在运行").setContentIntent(open).setOngoing(true).build());
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onTimeout(int startId,int type){stopSelf();}
}
