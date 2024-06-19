import { CommonModule } from "@angular/common";
import { Component, Inject, OnInit, ViewChild, ViewContainerRef } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, NavigationExtras, Router, RouterLink } from "@angular/router";
import { Subject, takeUntil, lastValueFrom, first, firstValueFrom } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nPipe } from "@bitwarden/angular/platform/pipes/i18n.pipe";
import { WINDOW } from "@bitwarden/angular/services/injection-tokens";
import {
  LoginStrategyServiceAbstraction,
  LoginEmailServiceAbstraction,
  UserDecryptionOptionsServiceAbstraction,
  TrustedDeviceUserDecryptionOption,
  UserDecryptionOptions,
} from "@bitwarden/auth/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { InternalMasterPasswordServiceAbstraction } from "@bitwarden/common/auth/abstractions/master-password.service.abstraction";
import { SsoLoginServiceAbstraction } from "@bitwarden/common/auth/abstractions/sso-login.service.abstraction";
import { TwoFactorService } from "@bitwarden/common/auth/abstractions/two-factor.service";
import { AuthenticationType } from "@bitwarden/common/auth/enums/authentication-type";
import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { AuthResult } from "@bitwarden/common/auth/models/domain/auth-result";
import { ForceSetPasswordReason } from "@bitwarden/common/auth/models/domain/force-set-password-reason";
import { TokenTwoFactorRequest } from "@bitwarden/common/auth/models/request/identity-token/token-two-factor.request";
import { TwoFactorProviders } from "@bitwarden/common/auth/services/two-factor.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import {
  AsyncActionsModule,
  ButtonModule,
  CheckboxModule,
  DialogModule,
  DialogService,
  FormFieldModule,
  IconModule,
  LinkModule,
  TypographyModule,
} from "@bitwarden/components";

import { CaptchaProtectedComponent } from "../captcha-protected.component";

import { TwoFactorAuthBaseComponent } from "./two-factor-auth-base.component";
import { TwoFactorAuthModule } from "./two-factor-auth.module";
import {
  TwoFactorOptionsDialogResult,
  TwoFactorOptionsComponent,
  TwoFactorOptionsDialogResultType,
} from "./two-factor-options.component";

@Component({
  standalone: true,
  selector: "app-two-factor-auth",
  templateUrl: "two-factor-auth.component.html",
  imports: [
    CommonModule,
    JslibModule,
    DialogModule,
    ButtonModule,
    LinkModule,
    TypographyModule,
    ReactiveFormsModule,
    FormFieldModule,
    AsyncActionsModule,
    RouterLink,
    TwoFactorAuthBaseComponent,
    TwoFactorOptionsComponent,
    FormFieldModule,
    AsyncActionsModule,
    CheckboxModule,
    ButtonModule,
    LinkModule,
    IconModule,
    TwoFactorAuthModule,
  ],
  providers: [I18nPipe],
})
// eslint-disable-next-line rxjs-angular/prefer-takeuntil
export class TwoFactorAuthComponent extends CaptchaProtectedComponent implements OnInit {
  @ViewChild("twoFactorOptions", { read: ViewContainerRef, static: true })
  twoFactorOptionsModal: ViewContainerRef;
  formGroup = this.formBuilder.group({
    token: [
      "",
      {
        validators: [Validators.required],
        updateOn: "submit",
      },
    ],
    remember: [false],
  });
  private destroy$ = new Subject<void>();
  providerData: any;
  actionButtonText = "";
  token = "";
  remember = false;
  providers = TwoFactorProviders;
  providerType = TwoFactorProviderType;
  selectedProviderType: TwoFactorProviderType = TwoFactorProviderType.Authenticator;
  title = "";
  formPromise: Promise<any>;
  orgIdentifier: string = null;

  onSuccessfulLogin: () => Promise<void>;
  onSuccessfulLoginNavigate: () => Promise<void>;

  onSuccessfulLoginTde: () => Promise<void>;
  onSuccessfulLoginTdeNavigate: () => Promise<void>;

  protected loginRoute = "login";

  protected trustedDeviceEncRoute = "login-initiated";
  protected changePasswordRoute = "set-password";
  protected forcePasswordResetRoute = "update-temp-password";
  protected successRoute = "vault";

  get isDuoProvider(): boolean {
    return (
      this.selectedProviderType === TwoFactorProviderType.Duo ||
      this.selectedProviderType === TwoFactorProviderType.OrganizationDuo
    );
  }

  constructor(
    protected loginStrategyService: LoginStrategyServiceAbstraction,
    protected router: Router,
    i18nService: I18nService,
    platformUtilsService: PlatformUtilsService,
    environmentService: EnvironmentService,
    private dialogService: DialogService,
    private route: ActivatedRoute,
    private logService: LogService,
    protected twoFactorService: TwoFactorService,
    private loginEmailService: LoginEmailServiceAbstraction,
    private userDecryptionOptionsService: UserDecryptionOptionsServiceAbstraction,
    protected ssoLoginService: SsoLoginServiceAbstraction,
    protected configService: ConfigService,
    private masterPasswordService: InternalMasterPasswordServiceAbstraction,
    private accountService: AccountService,
    private formBuilder: FormBuilder,
    @Inject(WINDOW) protected win: Window,
  ) {
    super(environmentService, i18nService, platformUtilsService);
    this.onSuccessfulLoginNavigate = this.goAfterLogIn;
  }

  async ngOnInit() {
    if (!(await this.authing()) || (await this.twoFactorService.getProviders()) == null) {
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.router.navigate([this.loginRoute]);
      return;
    }

    // eslint-disable-next-line rxjs-angular/prefer-takeuntil
    this.route.queryParams.pipe(first()).subscribe((qParams) => {
      if (qParams.identifier != null) {
        this.orgIdentifier = qParams.identifier;
      }
    });

    if (await this.needsLock()) {
      this.successRoute = "lock";
    }

    const webAuthnSupported = this.platformUtilsService.supportsWebAuthn(this.win);
    this.selectedProviderType = await this.twoFactorService.getDefaultProvider(webAuthnSupported);
    await this.init();

    this.actionButtonText = this.i18nService.t("continue");
    this.formGroup.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      this.token = value.token;
      this.remember = value.remember;
    });
  }

  submitForm = async () => {
    await this.submit();
  };

  async anotherMethod() {
    const dialogRef = TwoFactorOptionsComponent.open(this.dialogService);
    const response: TwoFactorOptionsDialogResultType = await lastValueFrom(dialogRef.closed);
    if (response.result === TwoFactorOptionsDialogResult.Provider) {
      this.selectedProviderType = response.type;
      const providerData = await this.twoFactorService.getProviders().then((providers) => {
        return providers.get(this.selectedProviderType);
      });
      this.providerData = providerData;
      await this.init();
    }
  }

  protected handleMigrateEncryptionKey(result: AuthResult): boolean {
    if (!result.requiresEncryptionKeyMigration) {
      return false;
    }
    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.router.navigate(["migrate-legacy-encryption"]);
    return true;
  }

  // protected handleMigrateEncryptionKey(result: AuthResult): boolean {
  //   if (!result.requiresEncryptionKeyMigration) {
  //     return false;
  //   }
  //
  //   this.platformUtilsService.showToast(
  //     "error",
  //     this.i18nService.t("errorOccured"),
  //     this.i18nService.t("encryptionKeyMigrationRequired"),
  //   );
  //   return true;
  // }

  goAfterLogIn = async () => {
    this.loginEmailService.clearValues();
    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.router.navigate([this.successRoute], {
      queryParams: {
        identifier: this.orgIdentifier,
      },
    });
  };

  async init() {
    if (this.selectedProviderType == null) {
      this.title = this.i18nService.t("loginUnavailable");
      return;
    }

    this.title = (TwoFactorProviders as any)[this.selectedProviderType].name;
  }

  async submit() {
    await this.setupCaptcha();

    if (this.token == null || this.token === "") {
      this.platformUtilsService.showToast(
        "error",
        this.i18nService.t("errorOccurred"),
        this.i18nService.t("verificationCodeRequired"),
      );
      return;
    }

    try {
      this.formPromise = this.loginStrategyService.logInTwoFactor(
        new TokenTwoFactorRequest(this.selectedProviderType, this.token, this.remember),
        this.captchaToken,
      );
      const authResult: AuthResult = await this.formPromise;
      await this.handleLoginResponse(authResult);
    } catch {
      this.logService.error("Error submitting two factor token");
    }
  }

  private async handleLoginResponse(authResult: AuthResult) {
    if (this.handleCaptchaRequired(authResult)) {
      return;
    } else if (this.handleMigrateEncryptionKey(authResult)) {
      return;
    }

    // Save off the OrgSsoIdentifier for use in the TDE flows
    // - TDE login decryption options component
    // - Browser SSO on extension open
    await this.ssoLoginService.setActiveUserOrganizationSsoIdentifier(this.orgIdentifier);
    this.loginEmailService.clearValues();

    // note: this flow affects both TDE & standard users
    if (this.isForcePasswordResetRequired(authResult)) {
      return await this.handleForcePasswordReset(this.orgIdentifier);
    }

    const userDecryptionOpts = await firstValueFrom(
      this.userDecryptionOptionsService.userDecryptionOptions$,
    );

    const tdeEnabled = await this.isTrustedDeviceEncEnabled(userDecryptionOpts.trustedDeviceOption);

    if (tdeEnabled) {
      return await this.handleTrustedDeviceEncryptionEnabled(
        authResult,
        this.orgIdentifier,
        userDecryptionOpts,
      );
    }

    // User must set password if they don't have one and they aren't using either TDE or key connector.
    const requireSetPassword =
      !userDecryptionOpts.hasMasterPassword && userDecryptionOpts.keyConnectorOption === undefined;

    if (requireSetPassword || authResult.resetMasterPassword) {
      // Change implies going no password -> password in this case
      return await this.handleChangePasswordRequired(this.orgIdentifier);
    }

    return await this.handleSuccessfulLogin();
  }

  private async isTrustedDeviceEncEnabled(
    trustedDeviceOption: TrustedDeviceUserDecryptionOption,
  ): Promise<boolean> {
    const ssoTo2faFlowActive = this.route.snapshot.queryParamMap.get("sso") === "true";

    return ssoTo2faFlowActive && trustedDeviceOption !== undefined;
  }

  private async handleTrustedDeviceEncryptionEnabled(
    authResult: AuthResult,
    orgIdentifier: string,
    userDecryptionOpts: UserDecryptionOptions,
  ): Promise<void> {
    // If user doesn't have a MP, but has reset password permission, they must set a MP
    if (
      !userDecryptionOpts.hasMasterPassword &&
      userDecryptionOpts.trustedDeviceOption.hasManageResetPasswordPermission
    ) {
      // Set flag so that auth guard can redirect to set password screen after decryption (trusted or untrusted device)
      // Note: we cannot directly navigate to the set password screen in this scenario as we are in a pre-decryption state, and
      // if you try to set a new MP before decrypting, you will invalidate the user's data by making a new user key.
      const userId = (await firstValueFrom(this.accountService.activeAccount$))?.id;
      await this.masterPasswordService.setForceSetPasswordReason(
        ForceSetPasswordReason.TdeUserWithoutPasswordHasPasswordResetPermission,
        userId,
      );
    }

    if (this.onSuccessfulLoginTde != null) {
      // Note: awaiting this will currently cause a hang on desktop & browser as they will wait for a full sync to complete
      // before navigating to the success route.
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.onSuccessfulLoginTde();
    }

    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.navigateViaCallbackOrRoute(
      this.onSuccessfulLoginTdeNavigate,
      // Navigate to TDE page (if user was on trusted device and TDE has decrypted
      //  their user key, the login-initiated guard will redirect them to the vault)
      [this.trustedDeviceEncRoute],
    );
  }

  private async handleChangePasswordRequired(orgIdentifier: string) {
    await this.router.navigate([this.changePasswordRoute], {
      queryParams: {
        identifier: orgIdentifier,
      },
    });
  }

  /**
   * Determines if a user needs to reset their password based on certain conditions.
   * Users can be forced to reset their password via an admin or org policy disallowing weak passwords.
   * Note: this is different from the SSO component login flow as a user can
   * login with MP and then have to pass 2FA to finish login and we can actually
   * evaluate if they have a weak password at that time.
   *
   * @param {AuthResult} authResult - The authentication result.
   * @returns {boolean} Returns true if a password reset is required, false otherwise.
   */
  private isForcePasswordResetRequired(authResult: AuthResult): boolean {
    const forceResetReasons = [
      ForceSetPasswordReason.AdminForcePasswordReset,
      ForceSetPasswordReason.WeakMasterPassword,
    ];

    return forceResetReasons.includes(authResult.forcePasswordReset);
  }

  private async handleForcePasswordReset(orgIdentifier: string) {
    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.router.navigate([this.forcePasswordResetRoute], {
      queryParams: {
        identifier: orgIdentifier,
      },
    });
  }

  private async handleSuccessfulLogin() {
    if (this.onSuccessfulLogin != null) {
      // Note: awaiting this will currently cause a hang on desktop & browser as they will wait for a full sync to complete
      // before navigating to the success route.
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.onSuccessfulLogin();
    }
    await this.navigateViaCallbackOrRoute(this.onSuccessfulLoginNavigate, [this.successRoute]);
  }

  private async navigateViaCallbackOrRoute(
    callback: () => Promise<unknown>,
    commands: unknown[],
    extras?: NavigationExtras,
  ): Promise<void> {
    if (callback) {
      await callback();
    } else {
      await this.router.navigate(commands, extras);
    }
  }

  private async authing(): Promise<boolean> {
    return (await firstValueFrom(this.loginStrategyService.currentAuthType$)) !== null;
  }

  private async needsLock(): Promise<boolean> {
    const authType = await firstValueFrom(this.loginStrategyService.currentAuthType$);
    return authType == AuthenticationType.Sso || authType == AuthenticationType.UserApiKey;
  }
}
