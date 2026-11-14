// Types for public/js/vendor/hpke.js, the parts of hpke and
// @panva/hpke-noble that scripts/vendor/hpke-entry.mjs bundles. Ours, not
// the packages' (as three.d.ts is three.js's): just those parts, in base
// mode (no PSK) and single-shot Seal and Open. Copied beside the bundle by
// scripts/vendor.mjs; edit this one, never the copy.

/** A key as the library holds it: opaque, used only through the suite. */
export interface Key {
  readonly algorithm: { name: string };
  readonly extractable: boolean;
  readonly type: "private" | "public" | (string & {});
}

export interface KeyPair {
  readonly publicKey: Readonly<Key>;
  readonly privateKey: Readonly<Key>;
}

/** What a KEM, KDF or AEAD factory gives the suite; opaque here. */
export type KEMFactory = () => Readonly<object>;
export type KDFFactory = () => Readonly<object>;
export type AEADFactory = () => Readonly<object>;

/** Base mode's options: additional data for the AEAD, and the info string. */
export interface SealOptions {
  aad?: Uint8Array;
  info?: Uint8Array;
}

export declare class CipherSuite {
  constructor(KEM: KEMFactory, KDF: KDFFactory, AEAD: AEADFactory);
  get KEM(): { readonly id: number; readonly name: string; readonly Nsecret: number; readonly Nenc: number; readonly Npk: number; readonly Nsk: number };
  get KDF(): { readonly id: number; readonly name: string; readonly Nh: number };
  get AEAD(): { readonly id: number; readonly name: string; readonly Nk: number; readonly Nn: number; readonly Nt: number };
  GenerateKeyPair(extractable?: boolean): Promise<KeyPair>;
  /** A key pair from input keying material (at least Nsk bytes). */
  DeriveKeyPair(ikm: Uint8Array, extractable?: boolean): Promise<KeyPair>;
  SerializePrivateKey(privateKey: Key): Promise<Uint8Array>;
  SerializePublicKey(publicKey: Key): Promise<Uint8Array>;
  DeserializePrivateKey(privateKey: Uint8Array, extractable?: boolean): Promise<Key>;
  DeserializePublicKey(publicKey: Uint8Array): Promise<Key>;
  Seal(publicKey: Key, plaintext: Uint8Array, options?: SealOptions): Promise<{ encapsulatedSecret: Uint8Array; ciphertext: Uint8Array }>;
  Open(privateKey: Key | KeyPair, encapsulatedSecret: Uint8Array, ciphertext: Uint8Array, options?: SealOptions): Promise<Uint8Array>;
}

/** HKDF-SHA256 (KDF id 0x0001), on Web Crypto. */
export declare const KDF_HKDF_SHA256: KDFFactory;
/** AES-256-GCM (AEAD id 0x0002), on Web Crypto. */
export declare const AEAD_AES_256_GCM: AEADFactory;
/** MLKEM768-X25519, X-Wing (KEM id 0x647a): @panva/hpke-noble's, pure JavaScript. */
export declare const KEM_MLKEM768_X25519: KEMFactory;
