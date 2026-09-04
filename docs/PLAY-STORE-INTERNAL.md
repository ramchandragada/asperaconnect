## Live Internal testing

**Join link (WhatsApp this to employees):**  
https://play.google.com/apps/internaltest/4701460117553190758

Version: **0.3.11** (versionCode 20) — Active on Internal testing.  
Testers: cashaameet@gmail.com, gadaramchandra@gmail.com, marketing@thegstco.com, priyanka@thegstco.com, ramchandragada@gmail.com, thegstco9@gmail.com

Employees: open link on phone → become a tester → Install from Play → Scan PC QR.



https://cdn.jsdelivr.net/gh/ramchandragada/asperaconnect@cursor/phone-contacts-sync-5b4f/website/privacy.html

## One-time on your Linux PC (upload key)

```bash
cd ~/asperaconnect   # or clone the repo
git checkout cursor/phone-contacts-sync-5b4f
git pull
chmod +x scripts/create-play-upload-keystore.sh scripts/build-play-aab.sh
./scripts/create-play-upload-keystore.sh
# BACK UP apps/android/play-upload.keystore + play-upload.properties
./scripts/build-play-aab.sh
# Output: dist/release/AsperaConnect-Phone-Play.aab
```

## Play Console clicks (marketing@thegstco.com)

1. https://play.google.com/console → sign in as **marketing@thegstco.com**
2. **Create app**
   - Name: `Aspera Connect`
   - Language: English (United States) or English (India)
   - App
   - Free
   - Declarations: accept
3. **All apps → Aspera Connect → Grow → Store presence → Main store listing**
   - Paste text from `docs/play-store/LISTING.txt`
   - App icon: use `apps/android/app/src/main/res/mipmap-*/` or export 512×512
   - Phone screenshots: 2+ images of the companion screen (you can screenshot the phone)
   - Privacy policy: URL above
4. **Policy → App content**
   - Privacy policy: same URL
   - Data safety: use `docs/play-store/DATA-SAFETY.txt`
   - Target audience: 18+ / workplace
   - News app: No
   - COVID: No
   - Ads: No
5. **Release → Testing → Internal testing**
   - Create email list: add employee Gmail / Workspace addresses (+ yours)
   - Create new release → upload `AsperaConnect-Phone-Play.aab`
   - Release name: `0.3.11`
   - Roll out to Internal testing
6. Copy **join link** / how testers join → send to employees (WhatsApp)

## What employees do

1. Open join link on phone (same Google account as in the list)
2. Install **Aspera Connect** from Play
3. Start for calls → Scan PC QR

No APK. No USB. No Developer Options.

## Package identity

- Application id: `com.asperaconnect.companion`
- First Play versionCode: `20` / versionName `0.3.11`

## After it works

Share only the Play join/install link in `SHARES.txt`. Keep APK for emergency IT only.
