# Aspera Connect — Beta testing guide (0.1.0-beta.1)

Thank you for testing. This build is free and local-first. Please report what works and what breaks.

## Install (Ubuntu / Mint / Zorin)

```bash
# 1) Install the app
sudo apt install ./aspera-connect_*_amd64.deb

# 2) Android Debug Bridge (usually pulled in as Depends)
sudo apt install adb

# 3) Scrcpy — prefer Snap 3.x (apt 1.25 is often too old for Android 14)
sudo snap install scrcpy
sudo snap connect scrcpy:gpu-2404 mesa-2404
sudo snap connect scrcpy:raw-usb   # helps USB access in some setups

# Confirm you are on a new scrcpy:
/snap/bin/scrcpy --version
```

Launch **Aspera Connect** from the app menu.

## First mirror

1. Phone: enable **Developer options** → **USB debugging**
2. On OnePlus / Xiaomi / similar: also enable **USB debugging (Security settings)**, then **reboot the phone**
3. Plug USB → unlock → tap **Allow** (always allow from this computer)
4. In Aspera Connect → **Refresh** → device should show `device` (not `unauthorized`)
5. **Start mirror**

## If you can see the phone but clicks do nothing

1. Confirm **USB debugging (Security settings)** is ON + phone rebooted  
2. Prefer `/snap/bin/scrcpy` (3.x), not apt 1.25  
3. Temporary workaround: HID mouse captures the cursor — press **Left Alt** to release it back to Linux

## What to report back

Please include:

- Distro + version (e.g. Ubuntu 24.04, Zorin 17)
- Phone model + Android version
- scrcpy path/version (`which -a scrcpy`; `/snap/bin/scrcpy --version`)
- Mirror OK? Clicks OK? Wireless OK?
- Any error text from the red banner in the app

## Uninstall

```bash
sudo apt remove aspera-connect
```

## License

Apache-2.0. Scrcpy/adb are separate tools invoked by the app (see NOTICE).
