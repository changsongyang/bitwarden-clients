import { firstValueFrom, map, mergeMap, of, switchMap } from "rxjs";

import { NotificationsService } from "@bitwarden/common/abstractions/notifications.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AutofillOverlayVisibility, ExtensionCommand } from "@bitwarden/common/autofill/constants";
import { AutofillSettingsServiceAbstraction } from "@bitwarden/common/autofill/services/autofill-settings.service";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { SystemService } from "@bitwarden/common/platform/abstractions/system.service";
import { devFlagEnabled } from "@bitwarden/common/platform/misc/flags";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { CipherType } from "@bitwarden/common/vault/enums";

import { MessageListener, isExternalMessage } from "../../../../libs/common/src/platform/messaging";
import {
  closeUnlockPopout,
  openSsoAuthResultPopout,
  openTwoFactorAuthPopout,
} from "../auth/popup/utils/auth-popout-window";
import { LockedVaultPendingNotificationsData } from "../autofill/background/abstractions/notification.background";
import { Fido2Background } from "../autofill/fido2/background/abstractions/fido2.background";
import { AutofillService } from "../autofill/services/abstractions/autofill.service";
import { BrowserApi } from "../platform/browser/browser-api";
import { BrowserEnvironmentService } from "../platform/services/browser-environment.service";
import { BrowserPlatformUtilsService } from "../platform/services/platform-utils/browser-platform-utils.service";

import MainBackground from "./main.background";

export default class RuntimeBackground {
  private autofillTimeout: any;
  private pageDetailsToAutoFill: any[] = [];
  private onInstalledReason: string = null;
  private lockedVaultPendingNotifications: LockedVaultPendingNotificationsData[] = [];
  private extensionRefreshIsActive: boolean = false;

  constructor(
    private main: MainBackground,
    private autofillService: AutofillService,
    private platformUtilsService: BrowserPlatformUtilsService,
    private notificationsService: NotificationsService,
    private autofillSettingsService: AutofillSettingsServiceAbstraction,
    private systemService: SystemService,
    private environmentService: BrowserEnvironmentService,
    private messagingService: MessagingService,
    private logService: LogService,
    private configService: ConfigService,
    private fido2Background: Fido2Background,
    private messageListener: MessageListener,
    private accountService: AccountService,
  ) {
    // onInstalled listener must be wired up before anything else, so we do it in the ctor
    chrome.runtime.onInstalled.addListener((details: any) => {
      this.onInstalledReason = details.reason;
    });
  }

  async init() {
    if (!chrome.runtime) {
      return;
    }

    await this.checkOnInstalled();
    const backgroundMessageListener = (
      msg: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: any) => void,
    ) => {
      const messagesWithResponse = [
        "biometricUnlock",
        "getUseTreeWalkerApiForPageDetailsCollectionFeatureFlag",
        "getInlineMenuFieldQualificationFeatureFlag",
      ];

      if (messagesWithResponse.includes(msg.command)) {
        this.processMessageWithSender(msg, sender).then(
          (value) => sendResponse({ result: value }),
          (error) => sendResponse({ error: { ...error, message: error.message } }),
        );
        return true;
      }

      void this.processMessageWithSender(msg, sender).catch((err) =>
        this.logService.error(
          `Error while processing message in RuntimeBackground '${msg?.command}'.`,
          err,
        ),
      );
      return false;
    };

    this.extensionRefreshIsActive = await this.configService.getFeatureFlag(
      FeatureFlag.ExtensionRefresh,
    );

    this.messageListener.allMessages$
      .pipe(
        mergeMap(async (message: any) => {
          try {
            await this.processMessage(message);
          } catch (err) {
            this.logService.error(err);
          }
        }),
      )
      .subscribe();

    // For messages that require the full on message interface
    BrowserApi.messageListener("runtime.background", backgroundMessageListener);
  }

  // Messages that need the chrome sender and send back a response need to be registered in this method.
  async processMessageWithSender(msg: any, sender: chrome.runtime.MessageSender) {
    switch (msg.command) {
      case "triggerAutofillScriptInjection":
        await this.autofillService.injectAutofillScripts(sender.tab, sender.frameId);
        break;
      case "bgCollectPageDetails":
        await this.main.collectPageDetailsForContentScript(sender.tab, msg.sender, sender.frameId);
        break;
      case "collectPageDetailsResponse":
        switch (msg.sender) {
          case "autofiller":
          case ExtensionCommand.AutofillCommand: {
            const activeUserId = await firstValueFrom(
              this.accountService.activeAccount$.pipe(map((a) => a?.id)),
            );
            await this.accountService.setAccountActivity(activeUserId, new Date());
            const totpCode = await this.autofillService.doAutoFillActiveTab(
              [
                {
                  frameId: sender.frameId,
                  tab: msg.tab,
                  details: msg.details,
                },
              ],
              msg.sender === ExtensionCommand.AutofillCommand,
            );
            if (totpCode != null) {
              this.platformUtilsService.copyToClipboard(totpCode);
            }
            break;
          }
          case ExtensionCommand.AutofillCard: {
            await this.autofillService.doAutoFillActiveTab(
              [
                {
                  frameId: sender.frameId,
                  tab: msg.tab,
                  details: msg.details,
                },
              ],
              msg.sender === ExtensionCommand.AutofillCard,
              CipherType.Card,
            );
            break;
          }
          case ExtensionCommand.AutofillIdentity: {
            await this.autofillService.doAutoFillActiveTab(
              [
                {
                  frameId: sender.frameId,
                  tab: msg.tab,
                  details: msg.details,
                },
              ],
              msg.sender === ExtensionCommand.AutofillIdentity,
              CipherType.Identity,
            );
            break;
          }
          case "contextMenu":
            clearTimeout(this.autofillTimeout);
            this.pageDetailsToAutoFill.push({
              frameId: sender.frameId,
              tab: msg.tab,
              details: msg.details,
            });
            this.autofillTimeout = setTimeout(async () => await this.autofillPage(msg.tab), 300);
            break;
          default:
            break;
        }
        break;
      case "biometricUnlock": {
        const result = await this.main.biometricUnlock();
        return result;
      }
      case "getUseTreeWalkerApiForPageDetailsCollectionFeatureFlag": {
        return await this.configService.getFeatureFlag(
          FeatureFlag.UseTreeWalkerApiForPageDetailsCollection,
        );
      }
      case "getInlineMenuFieldQualificationFeatureFlag": {
        return await this.configService.getFeatureFlag(FeatureFlag.InlineMenuFieldQualification);
      }
    }
  }

  async processMessage(msg: any) {
    switch (msg.command) {
      case "loggedIn":
      case "unlocked": {
        let item: LockedVaultPendingNotificationsData;

        if (msg.command === "loggedIn") {
          await this.main.initOverlayAndTabsBackground();
          await this.sendBwInstalledMessageToVault();
          await this.autofillService.reloadAutofillScripts();
        }

        if (this.lockedVaultPendingNotifications?.length > 0) {
          item = this.lockedVaultPendingNotifications.pop();
          await closeUnlockPopout();
        }

        await this.notificationsService.updateConnection(msg.command === "loggedIn");
        this.systemService.cancelProcessReload();

        if (item) {
          await BrowserApi.focusWindow(item.commandToRetry.sender.tab.windowId);
          await BrowserApi.focusTab(item.commandToRetry.sender.tab.id);
          await BrowserApi.tabSendMessageData(
            item.commandToRetry.sender.tab,
            "unlockCompleted",
            item,
          );
        }

        // @TODO these need to happen last to avoid blocking `tabSendMessageData` above
        // The underlying cause exists within `cipherService.getAllDecrypted` via
        // `getAllDecryptedForUrl` and is anticipated to be refactored
        await this.main.refreshBadge();
        await this.main.refreshMenu(false);

        if (this.extensionRefreshIsActive) {
          await this.autofillService.setAutoFillOnPageLoadOrgPolicy();
        }
        break;
      }
      case "addToLockedVaultPendingNotifications":
        this.lockedVaultPendingNotifications.push(msg.data);
        break;
      case "lockVault":
        await this.main.vaultTimeoutService.lock(msg.userId);
        break;
      case "logout":
        await this.main.logout(msg.expired, msg.userId);
        break;
      case "syncCompleted":
        if (msg.successfully) {
          setTimeout(async () => {
            await this.main.refreshBadge();
            await this.main.refreshMenu();
          }, 2000);
          await this.configService.ensureConfigFetched();
          await this.main.updateOverlayCiphers();

          if (this.extensionRefreshIsActive) {
            await this.autofillService.setAutoFillOnPageLoadOrgPolicy();
          }
        }
        break;
      case "openPopup":
        await this.main.openPopup();
        break;
      case "bgUpdateContextMenu":
      case "editedCipher":
      case "addedCipher":
      case "deletedCipher":
        await this.main.refreshBadge();
        await this.main.refreshMenu();
        break;
      case "bgReseedStorage": {
        const doFillBuffer = await firstValueFrom(
          this.accountService.activeAccount$.pipe(
            switchMap((account) => {
              if (account == null) {
                return of(false);
              }

              return this.configService.userCachedFeatureFlag$(
                FeatureFlag.StorageReseedRefactor,
                account.id,
              );
            }),
          ),
        );

        await this.main.reseedStorage(doFillBuffer);
        break;
      }
      case "authResult": {
        const env = await firstValueFrom(this.environmentService.environment$);
        const vaultUrl = env.getWebVaultUrl();

        if (msg.referrer == null || Utils.getHostname(vaultUrl) !== msg.referrer) {
          return;
        }

        if (msg.lastpass) {
          this.messagingService.send("importCallbackLastPass", {
            code: msg.code,
            state: msg.state,
          });
        } else {
          try {
            await openSsoAuthResultPopout(msg);
          } catch {
            this.logService.error("Unable to open sso popout tab");
          }
        }
        break;
      }
      case "webAuthnResult": {
        const env = await firstValueFrom(this.environmentService.environment$);
        const vaultUrl = env.getWebVaultUrl();

        if (msg.referrer == null || Utils.getHostname(vaultUrl) !== msg.referrer) {
          return;
        }

        await openTwoFactorAuthPopout(msg);
        break;
      }
      case "reloadPopup":
        if (isExternalMessage(msg)) {
          this.messagingService.send("reloadPopup");
        }
        break;
      case "emailVerificationRequired":
        this.messagingService.send("showDialog", {
          title: { key: "emailVerificationRequired" },
          content: { key: "emailVerificationRequiredDesc" },
          acceptButtonText: { key: "ok" },
          cancelButtonText: null,
          type: "info",
        });
        break;
      case "getClickedElementResponse":
        this.platformUtilsService.copyToClipboard(msg.identifier);
        break;
      case "switchAccount": {
        await this.main.switchAccount(msg.userId);
        break;
      }
      case "clearClipboard": {
        await this.main.clearClipboard(msg.clipboardValue, msg.timeoutMs);
        break;
      }
    }
  }

  private async autofillPage(tabToAutoFill: chrome.tabs.Tab) {
    const totpCode = await this.autofillService.doAutoFill({
      tab: tabToAutoFill,
      cipher: this.main.loginToAutoFill,
      pageDetails: this.pageDetailsToAutoFill,
      fillNewPassword: true,
      allowTotpAutofill: true,
    });

    if (totpCode != null) {
      this.platformUtilsService.copyToClipboard(totpCode);
    }

    // reset
    this.main.loginToAutoFill = null;
    this.pageDetailsToAutoFill = [];
  }

  private async checkOnInstalled() {
    setTimeout(async () => {
      void this.fido2Background.injectFido2ContentScriptsInAllTabs();
      void this.autofillService.loadAutofillScriptsOnInstall();

      if (this.onInstalledReason != null) {
        if (this.onInstalledReason === "install") {
          if (!devFlagEnabled("skipWelcomeOnInstall")) {
            void BrowserApi.createNewTab("https://bitwarden.com/browser-start/");
          }

          await this.autofillSettingsService.setInlineMenuVisibility(
            AutofillOverlayVisibility.OnFieldFocus,
          );

          if (await this.environmentService.hasManagedEnvironment()) {
            await this.environmentService.setUrlsToManagedEnvironment();
          }
        }

        this.onInstalledReason = null;
      }
    }, 100);
  }

  async sendBwInstalledMessageToVault() {
    try {
      const env = await firstValueFrom(this.environmentService.environment$);
      const vaultUrl = env.getWebVaultUrl();
      const urlObj = new URL(vaultUrl);

      const tabs = await BrowserApi.tabsQuery({ url: `${urlObj.href}*` });

      if (!tabs?.length) {
        return;
      }

      for (const tab of tabs) {
        await BrowserApi.executeScriptInTab(tab.id, {
          file: "content/send-on-installed-message.js",
          runAt: "document_end",
        });
      }
    } catch (e) {
      this.logService.error(`Error sending on installed message to vault: ${e}`);
    }
  }
}
