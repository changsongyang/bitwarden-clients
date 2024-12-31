import { DIALOG_DATA } from "@angular/cdk/dialog";
import { CommonModule } from "@angular/common";
import { Component, Inject } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import {
  ButtonModule,
  DialogModule,
  DialogService,
  ItemModule,
  LinkModule,
} from "@bitwarden/components";
import {
  CredentialGeneratorHistoryDialogComponent,
  GeneratorModule,
} from "@bitwarden/generator-components";
import { GeneratedCredential } from "@bitwarden/generator-core";

export type CredentialGeneratorParams = {
  onCredentialGenerated: (value?: string) => void;
  type: "password" | "username";
};

@Component({
  standalone: true,
  selector: "credential-generator",
  templateUrl: "credential-generator.component.html",
  imports: [
    CommonModule,
    DialogModule,
    ButtonModule,
    JslibModule,
    GeneratorModule,
    ItemModule,
    LinkModule,
  ],
})
export class CredentialGeneratorComponent {
  credentials?: GeneratedCredential;

  constructor(
    @Inject(DIALOG_DATA) protected data: CredentialGeneratorParams,
    private dialogService: DialogService,
  ) {}

  applyCredentials = () => {
    this.data.onCredentialGenerated(this.credentials?.credential);
  };

  clearCredentials = () => {
    this.data.onCredentialGenerated();
  };

  onCredentialGenerated = (generatedCred: GeneratedCredential) => {
    this.credentials = generatedCred;
  };

  openHistoryDialog = () => {
    // open history dialog
    this.dialogService.open(CredentialGeneratorHistoryDialogComponent);
  };
}
