// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Component, OnDestroy, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom, map } from "rxjs";

import { ChangePasswordComponent as BaseChangePasswordComponent } from "@bitwarden/angular/auth/components/change-password.component";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { InternalMasterPasswordServiceAbstraction } from "@bitwarden/common/auth/abstractions/master-password.service.abstraction";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { PasswordRequest } from "@bitwarden/common/auth/models/request/password.request";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { HashPurpose } from "@bitwarden/common/platform/enums";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";
import { DialogService, ToastService } from "@bitwarden/components";
import { PasswordGenerationServiceAbstraction } from "@bitwarden/generator-legacy";
import { KdfConfigService, KeyService } from "@bitwarden/key-management";

import { UserKeyRotationService } from "../../key-management/key-rotation/user-key-rotation.service";

@Component({
  selector: "app-change-password",
  templateUrl: "change-password.component.html",
})
export class ChangePasswordComponent
  extends BaseChangePasswordComponent
  implements OnInit, OnDestroy
{
  rotateUserKey = false;
  currentMasterPassword: string;
  masterPasswordHint: string;
  checkForBreaches = true;
  characterMinimumMessage = "";

  constructor(
    i18nService: I18nService,
    keyService: KeyService,
    messagingService: MessagingService,
    stateService: StateService,
    passwordGenerationService: PasswordGenerationServiceAbstraction,
    platformUtilsService: PlatformUtilsService,
    policyService: PolicyService,
    private auditService: AuditService,
    private cipherService: CipherService,
    private syncService: SyncService,
    private apiService: ApiService,
    private router: Router,
    dialogService: DialogService,
    private userVerificationService: UserVerificationService,
    private keyRotationService: UserKeyRotationService,
    kdfConfigService: KdfConfigService,
    protected masterPasswordService: InternalMasterPasswordServiceAbstraction,
    accountService: AccountService,
    toastService: ToastService,
    private fullApiService: ApiService,
    private tokenService: TokenService,
  ) {
    super(
      i18nService,
      keyService,
      messagingService,
      passwordGenerationService,
      platformUtilsService,
      policyService,
      stateService,
      dialogService,
      kdfConfigService,
      masterPasswordService,
      accountService,
      toastService,
    );
  }

  async ngOnInit() {
    if (!(await this.userVerificationService.hasMasterPassword())) {
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.router.navigate(["/settings/security/two-factor"]);
    }

    await super.ngOnInit();

    this.characterMinimumMessage = this.i18nService.t("characterMinimum", this.minimumLength);
  }

  async rotateUserKeyClicked() {
    if (this.rotateUserKey) {
      const ciphers = await this.cipherService.getAllDecrypted();
      let hasOldAttachments = false;
      if (ciphers != null) {
        for (let i = 0; i < ciphers.length; i++) {
          if (ciphers[i].organizationId == null && ciphers[i].hasOldAttachments) {
            hasOldAttachments = true;
            break;
          }
        }
      }

      if (hasOldAttachments) {
        const learnMore = await this.dialogService.openSimpleDialog({
          title: { key: "warning" },
          content: { key: "oldAttachmentsNeedFixDesc" },
          acceptButtonText: { key: "learnMore" },
          cancelButtonText: { key: "close" },
          type: "warning",
        });

        if (learnMore) {
          this.platformUtilsService.launchUri(
            "https://bitwarden.com/help/attachments/#add-storage-space",
          );
        }
        this.rotateUserKey = false;
        return;
      }

      const result = await this.dialogService.openSimpleDialog({
        title: { key: "rotateEncKeyTitle" },
        content:
          this.i18nService.t("updateEncryptionKeyWarning") +
          " " +
          this.i18nService.t("updateEncryptionKeyExportWarning") +
          " " +
          this.i18nService.t("rotateEncKeyConfirmation"),
        type: "warning",
      });

      if (!result) {
        this.rotateUserKey = false;
      }
    }
  }

  async submit() {
    if (
      this.masterPasswordHint != null &&
      this.masterPasswordHint.toLowerCase() === this.masterPassword.toLowerCase()
    ) {
      this.toastService.showToast({
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message: this.i18nService.t("hintEqualsPassword"),
      });
      return;
    }

    this.leakedPassword = false;
    if (this.checkForBreaches) {
      this.leakedPassword = (await this.auditService.passwordLeaked(this.masterPassword)) > 0;
    }

    if (!(await this.strongPassword())) {
      return;
    }

    if (this.rotateUserKey) {
      await this.syncService.fullSync(true);
      const user = await firstValueFrom(this.accountService.activeAccount$);
      await this.keyRotationService.rotateUserKeyMasterPasswordAndEncryptedData(
        this.currentMasterPassword,
        this.masterPassword,
        user,
      );
    } else {
      await this.updatePassword(this.masterPassword);
    }
  }

  // todo: move this to a service
  private async updatePassword(newMasterPassword: string) {
    const currentMasterPassword = this.currentMasterPassword;
    const { userId, email } = await firstValueFrom(
      this.accountService.activeAccount$.pipe(map((a) => ({ userId: a?.id, email: a?.email }))),
    );
    const kdfConfig = await firstValueFrom(this.kdfConfigService.getKdfConfig$(userId));

    const currentMasterKey = await this.keyService.makeMasterKey(
      currentMasterPassword,
      email,
      kdfConfig,
    );
    const decryptedUserKey = await this.masterPasswordService.decryptUserKeyWithMasterKey(
      currentMasterKey,
      userId,
    );
    if (decryptedUserKey == null) {
      this.toastService.showToast({
        variant: "error",
        title: null,
        message: this.i18nService.t("invalidMasterPassword"),
      });
      return;
    }

    const newMasterKey = await this.keyService.makeMasterKey(newMasterPassword, email, kdfConfig);
    const newMasterKeyEncryptedUserKey = await this.keyService.encryptUserKeyWithMasterKey(
      newMasterKey,
      decryptedUserKey,
    );

    const request = new PasswordRequest();
    request.masterPasswordHash = await this.keyService.hashMasterKey(
      this.currentMasterPassword,
      currentMasterKey,
    );
    request.masterPasswordHint = this.masterPasswordHint;
    request.newMasterPasswordHash = await this.keyService.hashMasterKey(
      newMasterPassword,
      newMasterKey,
    );
    request.key = newMasterKeyEncryptedUserKey[1].encryptedString;
    try {
      await this.apiService.postPassword(request);
      this.toastService.showToast({
        variant: "success",
        title: this.i18nService.t("masterPasswordChanged"),
        message: this.i18nService.t("masterPasswordChangedDesc"),
      });
      const newSecurityStamp = (await this.fullApiService.getSync()).profile.securityStamp;
      await this.tokenService.setSecurityStamp(newSecurityStamp);
      await this.keyService.setMasterKeyEncryptedUserKey(
        newMasterKeyEncryptedUserKey[1].encryptedString,
        userId,
      );
      await this.keyService.setUserKey(decryptedUserKey, userId);
      await this.syncService.fullSync(true);
      await this.masterPasswordService.setMasterKeyHash(
        await this.keyService.hashMasterKey(
          newMasterPassword,
          newMasterKey,
          HashPurpose.LocalAuthorization,
        ),
        userId,
      );
      await this.masterPasswordService.setMasterKey(newMasterKey, userId);
    } catch {
      this.toastService.showToast({
        variant: "error",
        title: null,
        message: this.i18nService.t("errorOccurred"),
      });
    }
  }
}
