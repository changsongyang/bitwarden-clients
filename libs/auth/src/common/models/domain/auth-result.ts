import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { ForceSetPasswordReason } from "@bitwarden/common/auth/models/domain/force-set-password-reason";
import { UserId } from "@bitwarden/common/types/guid";

export class AuthResult {
  captchaSiteKey?: string;
  twoFactorProviders?: Map<TwoFactorProviderType, { [key: string]: string }>;
  ssoEmail2FaSessionToken?: string;
  requiresEncryptionKeyMigration = false;
  requiresDeviceVerification = false;
  resetMasterPassword = false;
  forcePasswordReset: ForceSetPasswordReason = ForceSetPasswordReason.None;
  email?: string;
  userId?: UserId;

  get requiresTwoFactor(): boolean {
    return this.twoFactorProviders != null;
  }

  get requiresCaptcha(): boolean {
    return this.captchaSiteKey != null;
  }
}
