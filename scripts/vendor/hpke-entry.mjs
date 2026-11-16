// The HPKE parts the contacts' identity keys use, bundled by
// scripts/vendor.mjs into one minified public/js/vendor/hpke.js: the
// suite MLKEM768-X25519 (X-Wing, HPKE id 0x647a), HKDF-SHA256 and
// AES-256-GCM. The KEM is @panva/hpke-noble's, pure JavaScript, in every
// browser, even where Chrome has it natively (see considerations.md,
// "Post-quantum library"); the KDF and AEAD are hpke's own, on Web Crypto.
// Add a name here (and to hpke.d.ts beside this file) to use it.
export { CipherSuite, KDF_HKDF_SHA256, AEAD_AES_256_GCM } from "hpke";
export { KEM_MLKEM768_X25519 } from "@panva/hpke-noble";
