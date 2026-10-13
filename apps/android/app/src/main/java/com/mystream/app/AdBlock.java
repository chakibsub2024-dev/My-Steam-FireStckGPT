package com.mystream.app;

import android.content.Context;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.HashSet;
import java.util.Set;

/** Blocks requests to known ad/tracker hosts (and their subdomains). */
final class AdBlock {
    private final Set<String> hosts = new HashSet<>();

    AdBlock(Context ctx) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(ctx.getAssets().open("ad-domains.txt"), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim().toLowerCase();
                if (!line.isEmpty() && !line.startsWith("#")) hosts.add(line);
            }
        } catch (Exception ignored) {
            // No list: nothing is blocked.
        }
    }

    boolean isBlocked(String host) {
        if (host == null) return false;
        String h = host.toLowerCase();
        while (true) {
            if (hosts.contains(h)) return true;
            int dot = h.indexOf('.');
            if (dot < 0) return false;
            h = h.substring(dot + 1);
        }
    }
}
