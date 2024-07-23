/* tslint:disable */
/* eslint-disable */

/* auto-generated by NAPI-RS */

export namespace passwords {
  /** Fetch the stored password from the keychain. */
  export function getPassword(service: string, account: string): Promise<string>
  /** Fetch the stored password from the keychain that was stored with Keytar. */
  export function getPasswordKeytar(service: string, account: string): Promise<string>
  /** Save the password to the keychain. Adds an entry if none exists otherwise updates the existing entry. */
  export function setPassword(service: string, account: string, password: string): Promise<void>
  /** Delete the stored password from the keychain. */
  export function deletePassword(service: string, account: string): Promise<void>
}
export namespace biometrics {
  export function prompt(hwnd: Buffer, message: string): Promise<boolean>
  export function available(): Promise<boolean>
  export function setBiometricSecret(service: string, account: string, secret: string, keyMaterial: KeyMaterial | undefined | null, ivB64: string): Promise<string>
  export function getBiometricSecret(service: string, account: string, keyMaterial?: KeyMaterial | undefined | null): Promise<string>
  /**
   * Derives key material from biometric data. Returns a string encoded with a
   * base64 encoded key and the base64 encoded challenge used to create it
   * separated by a `|` character.
   *
   * If the iv is provided, it will be used as the challenge. Otherwise a random challenge will be generated.
   *
   * `format!("<key_base64>|<iv_base64>")`
   */
  export function deriveKeyMaterial(iv?: string | undefined | null): Promise<OsDerivedKey>
  export interface KeyMaterial {
    osKeyPartB64: string
    clientKeyPartB64?: string
  }
  export interface OsDerivedKey {
    keyB64: string
    ivB64: string
  }
}
export namespace clipboards {
  export function read(): Promise<string>
  export function write(text: string, password: boolean): Promise<void>
}
export namespace autofill {
  export function runCommand(value: string): Promise<string>
}
