package com.aura.companion;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 动态切换桌面图标（第 22.2 章）。
 * 做法：先禁用当前 alias，再启用目标 alias。
 * 绝不能用 killProcess —— 会丢用户没发出去的输入。
 */
@CapacitorPlugin(name = "IconSwitcher")
public class IconSwitcherPlugin extends Plugin {

    private static final String[] ALIASES = {
        "AliasDefault", "AliasWarm", "AliasBlue", "AliasRose", "AliasViolet"
    };

    @PluginMethod
    public void switchIcon(PluginCall call) {
        String target = call.getString("name", "AliasDefault");
        boolean known = false;
        for (String a : ALIASES) {
            if (a.equals(target)) known = true;
        }
        if (!known) {
            call.reject("unknown alias: " + target);
            return;
        }
        try {
            String pkg = getContext().getPackageName();
            PackageManager pm = getContext().getPackageManager();
            // 先全部关掉
            for (String a : ALIASES) {
                pm.setComponentEnabledSetting(
                    new ComponentName(pkg, pkg + "." + a),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP);
            }
            // 再打开目标
            pm.setComponentEnabledSetting(
                new ComponentName(pkg, pkg + "." + target),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("name", target);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("switch failed", e);
        }
    }

    @PluginMethod
    public void currentIcon(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            PackageManager pm = getContext().getPackageManager();
            String current = "AliasDefault";
            for (String a : ALIASES) {
                int state = pm.getComponentEnabledSetting(new ComponentName(pkg, pkg + "." + a));
                if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                    current = a;
                    break;
                }
            }
            JSObject ret = new JSObject();
            ret.put("name", current);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read failed", e);
        }
    }
}
