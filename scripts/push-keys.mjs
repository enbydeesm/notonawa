// Makes the key pair push notifications are sent with (VAPID, src/push/).
// Run it once per environment, on your own computer:
//
//   node scripts/push-keys.mjs
//
// It prints both halves and saves neither. The public key goes in
// wrangler.jsonc as VAPID_PUBLIC_KEY (the top level for production, env.dev
// for dev); the private key is a secret, set with
//
//   npx wrangler secret put VAPID_PRIVATE_KEY            (production)
//   npx wrangler secret put VAPID_PRIVATE_KEY --env dev  (dev)
//
// then deploy. Keep the private key in your password manager too. Devices
// subscribe with the public key: a new pair later means every device turns
// notifications on again (the app shows them as off), so only replace it if
// the private key may have leaked.

import { newVapidKeys } from "../src/push/webpush.js";

const { publicKey, privateKey } = await newVapidKeys();
console.log(`VAPID_PUBLIC_KEY (wrangler.jsonc):\n${publicKey}\n`);
console.log(`VAPID_PRIVATE_KEY (paste it when wrangler secret put asks; don't save it in the repo):\n${privateKey}`);
