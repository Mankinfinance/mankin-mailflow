#!/usr/bin/env bash
# Opens the freshly built Android app on an emulator, waits for the
# first screen, and keeps a screenshot and the app's log in smoke/.
# Run by the "smoke" job in mobile-android.yml, inside the emulator.
set -u
mkdir -p smoke
adb install -r apk/*.apk
adb logcat -c
adb shell am start -W -n au.com.mankinfinance.mailflow/.MainActivity
sleep 30
adb exec-out screencap -p > smoke/launch.png
adb logcat -d -v time Mailflow:V Capacitor:V chromium:W cr_AwContents:W '*:S' > smoke/logcat.txt
echo "---- app log ----"
cat smoke/logcat.txt
echo "---- focused window ----"
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true
