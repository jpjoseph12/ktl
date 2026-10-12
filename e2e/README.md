# End-to-end tests (Appium + WebdriverIO)

These drive the real, installed Android app on an emulator, through the
actual Capacitor WebView, against a real KTL server. That's a different
tier from `npm test` (Vitest + Testing Library): the component tests check
logic and rendering in isolation; these check that the built app works.

Each run starts from a fresh install, so it goes through the same screens a
new user would:
1. The **Connect** screen, entering the test server's address.
2. **Log in**, with the account the test server was set up with.
3. The household (bills, money lent, the balance) and Yours (debts).

## The test server

`scripts/e2e-server.mjs` starts a throwaway KTL server in Docker, from the
`ktl:latest` image, on port 8095. It then sets the server up through the
same `/setup` API a person would use:
- an owner account, `e2e-owner@ktl.test`;
- a household with one other person in it, since splitting a bill needs
  someone to split it with.

```bash
docker build -f selfhost/Dockerfile -t ktl:latest .
node scripts/e2e-server.mjs          # start and set up
node scripts/e2e-server.mjs --stop   # throw it away
```

The emulator reaches your machine at `10.0.2.2`, so the app connects to
`http://10.0.2.2:8095`. Override it with `E2E_SERVER`, and the account
with `E2E_EMAIL` and `E2E_PASSWORD`.

## Running locally

1. **Boot an Android emulator (AVD).**

   ```
   emulator -avd <your-avd-name> -no-snapshot -noaudio
   ```

   `wdio.conf.js` targets `emulator-5554`. Set `ANDROID_UDID` if yours is
   different, or if a phone is connected at the same time.
2. **Export `ANDROID_HOME`** (or `ANDROID_SDK_ROOT`) in the shell you run
   the tests from. Appium starts its own server process, which doesn't
   pick it up from elsewhere.
3. **Build the app**, with no server address built in:

   ```
   npm run build && npx cap sync android
   cd android && ./gradlew assembleDebug    # gradlew.bat on Windows
   ```

4. **Install Appium's Android driver**, once: `npx appium driver install uiautomator2`.
5. **Start the test server** (above), then run:

   ```
   npm run test:e2e
   ```

Logs, and a screenshot and page source for every failure, land in
`e2e/logs/`.

## In CI

`.github/workflows/tests.yml` does the same on a phone and a tablet
emulator. It builds the server image, starts the test server, builds the
APK and runs the suite. No secrets are needed.

## What's covered

Every major screen flow is covered:
- connect and log in;
- adding a bill, and money lent, and recording a payment;
- adding a debt and hitting the minimum-payment floor;
- who's in, and which server this is;
- the notification-permission prompt;
- the balance screen.

The Vitest suite covers the pure-function edge cases (rounding,
percentage-split drift and so on). They're tested there because it's
faster and more precise than repeating them through the screen.
