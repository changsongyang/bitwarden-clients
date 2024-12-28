import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { ButtonModule, FormFieldModule, IconButtonModule, LinkModule } from "@bitwarden/components";

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
export class NewDeviceVerificationComponent implements OnInit {
  formGroup = this.formBuilder.group({
    code: ["", [Validators.required]],
  });

  protected disableRequestOTP = false;
  protected sentInitialCode = false;
  protected sentCode = false;

  constructor(
    private router: Router,
    private formBuilder: FormBuilder,
    private userVerificationService: UserVerificationService,
  ) {}

  async ngOnInit() {
    // Request initial OTP on component load
    await this.requestOTP();
  }

  async requestOTP() {
    this.disableRequestOTP = true;
    try {
      await this.userVerificationService.requestOTP();
      this.sentCode = true;
      this.sentInitialCode = true;

      // Reset sentCode after 3 seconds
      setTimeout(() => {
        this.sentCode = false;
      }, 3000);
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

      await this.userVerificationService.verifyUser({
        type: VerificationType.OTP,
        secret: code,
      });

      // If verification succeeds, navigate to vault
      await this.router.navigate(["/vault"]);
    } catch (e) {
      // Handle verification error
      codeControl.setErrors({ invalid: true });
    }
  }
}
