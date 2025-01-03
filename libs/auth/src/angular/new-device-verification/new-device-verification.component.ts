import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { Subject, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { DeviceVerificationRequest } from "@bitwarden/common/auth/models/request/device-verification.request";
import { ButtonModule, FormFieldModule, IconButtonModule, LinkModule } from "@bitwarden/components";

import { PasswordLoginStrategy } from "../../common/login-strategies/password-login.strategy";

@Component({
  standalone: true,
  selector: "app-new-device-verification",
  templateUrl: "./new-device-verification.component.html",
  imports: [
    CommonModule,
    ReactiveFormsModule,
    JslibModule,
    ButtonModule,
    FormFieldModule,
    IconButtonModule,
    LinkModule,
  ],
})
export class NewDeviceVerificationComponent implements OnInit, OnDestroy {
  formGroup = this.formBuilder.group({
    code: ["", [Validators.required]],
  });

  protected disableRequestOTP = false;
  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private formBuilder: FormBuilder,
    private passwordLoginStrategy: PasswordLoginStrategy,
    private apiService: ApiService,
  ) {}

  async ngOnInit() {
    // Redirect to login if session times out
    this.passwordLoginStrategy.sessionTimeout$
      .pipe(takeUntil(this.destroy$))
      .subscribe((timedOut) => {
        if (timedOut) {
          void this.router.navigate(["/login"]);
        }
      });

    // Request initial OTP on component load
    // await this.requestOTP();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async requestOTP() {
    this.disableRequestOTP = true;
    try {
      await this.apiService.send("POST", "/accounts/request-otp", null, true, false);
    } finally {
      this.disableRequestOTP = false;
    }
  }

  async submit() {
    if (this.formGroup.invalid) {
      return;
    }

    const codeControl = this.formGroup.get("code");
    if (!codeControl) {
      return;
    }

    try {
      const code = codeControl.value;
      if (code === null) {
        return;
      }

      const deviceVerificationRequest = new DeviceVerificationRequest(true, code);
      const authResult =
        await this.passwordLoginStrategy.logInNewDeviceVerification(deviceVerificationRequest);

      if (authResult.requiresTwoFactor) {
        await this.router.navigate(["/2fa"]);
        return;
      }

      if (authResult.forcePasswordReset) {
        await this.router.navigate(["/update-temp-password"]);
        return;
      }

      // If verification succeeds, navigate to vault
      await this.router.navigate(["/vault"]);
    } catch (e) {
      // Handle verification error
      codeControl.setErrors({ invalid: true });
    }
  }
}
