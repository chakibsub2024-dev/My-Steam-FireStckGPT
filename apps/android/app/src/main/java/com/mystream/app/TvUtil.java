package com.mystream.app;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;

final class TvUtil {
    private TvUtil() {}

    /** True on Android TV, Google TV and Fire TV. */
    static boolean isTv(Context ctx) {
        UiModeManager ui = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
        if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) return true;
        PackageManager pm = ctx.getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) || pm.hasSystemFeature("amazon.hardware.fire_tv");
    }
}
