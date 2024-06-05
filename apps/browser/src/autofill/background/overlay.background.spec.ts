import { mock, MockProxy, mockReset } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { AutofillOverlayVisibility } from "@bitwarden/common/autofill/constants";
import { AutofillSettingsServiceAbstraction as AutofillSettingsService } from "@bitwarden/common/autofill/services/autofill-settings.service";
import {
  DefaultDomainSettingsService,
  DomainSettingsService,
} from "@bitwarden/common/autofill/services/domain-settings.service";
import { InlineMenuVisibilitySetting } from "@bitwarden/common/autofill/types";
import {
  EnvironmentService,
  Region,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { ThemeType } from "@bitwarden/common/platform/enums";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { CloudEnvironment } from "@bitwarden/common/platform/services/default-environment.service";
import { ThemeStateService } from "@bitwarden/common/platform/theming/theme-state.service";
import {
  FakeAccountService,
  FakeStateProvider,
  mockAccountServiceWith,
} from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { BrowserApi } from "../../platform/browser/browser-api";
import { BrowserPlatformUtilsService } from "../../platform/services/platform-utils/browser-platform-utils.service";
import { AutofillOverlayElement, AutofillOverlayPort } from "../enums/autofill-overlay.enum";
import { AutofillService } from "../services/abstractions/autofill.service";
import {
  createChromeTabMock,
  createAutofillPageDetailsMock,
  createPortSpyMock,
  createFocusedFieldDataMock,
} from "../spec/autofill-mocks";
import { flushPromises, sendMockExtensionMessage } from "../spec/testing-utils";

import {
  FocusedFieldData,
  PageDetailsForTab,
  SubFrameOffsetData,
  SubFrameOffsetsForTab,
} from "./abstractions/overlay.background";
import { OverlayBackground } from "./overlay.background";

describe("OverlayBackground", () => {
  const mockUserId = Utils.newGuid() as UserId;
  const sendResponse = jest.fn();
  let accountService: FakeAccountService;
  let fakeStateProvider: FakeStateProvider;
  let showFaviconsMock$: BehaviorSubject<boolean>;
  let domainSettingsService: DomainSettingsService;
  let logService: MockProxy<LogService>;
  let cipherService: MockProxy<CipherService>;
  let autofillService: MockProxy<AutofillService>;
  let activeAccountStatusMock$: BehaviorSubject<AuthenticationStatus>;
  let authService: MockProxy<AuthService>;
  let environmentMock$: BehaviorSubject<CloudEnvironment>;
  let environmentService: MockProxy<EnvironmentService>;
  let inlineMenuVisibilityMock$: BehaviorSubject<InlineMenuVisibilitySetting>;
  let autofillSettingsService: MockProxy<AutofillSettingsService>;
  let i18nService: MockProxy<I18nService>;
  let platformUtilsService: MockProxy<BrowserPlatformUtilsService>;
  let selectedThemeMock$: BehaviorSubject<ThemeType>;
  let themeStateService: MockProxy<ThemeStateService>;
  let overlayBackground: OverlayBackground;
  let portKeyForTabSpy: Record<number, string>;
  let pageDetailsForTabSpy: PageDetailsForTab;
  let subFrameOffsetsSpy: SubFrameOffsetsForTab;
  let getFrameDetailsSpy: jest.SpyInstance;
  let tabsSendMessageSpy: jest.SpyInstance;
  let sendMessageSpy: jest.SpyInstance;
  let getTabFromCurrentWindowIdSpy: jest.SpyInstance;
  let buttonPortSpy: chrome.runtime.Port;
  let listPortSpy: chrome.runtime.Port;

  let getFrameCounter: number = 2;
  async function initOverlayElementPorts(options = { initList: true, initButton: true }) {
    const { initList, initButton } = options;
    if (initButton) {
      await overlayBackground["handlePortOnConnect"](createPortSpyMock(AutofillOverlayPort.Button));
      buttonPortSpy = overlayBackground["inlineMenuButtonPort"];
    }

    if (initList) {
      await overlayBackground["handlePortOnConnect"](createPortSpyMock(AutofillOverlayPort.List));
      listPortSpy = overlayBackground["inlineMenuListPort"];
    }

    return { buttonPortSpy, listPortSpy };
  }

  beforeEach(() => {
    accountService = mockAccountServiceWith(mockUserId);
    fakeStateProvider = new FakeStateProvider(accountService);
    showFaviconsMock$ = new BehaviorSubject(true);
    domainSettingsService = new DefaultDomainSettingsService(fakeStateProvider);
    domainSettingsService.showFavicons$ = showFaviconsMock$;
    logService = mock<LogService>();
    cipherService = mock<CipherService>();
    autofillService = mock<AutofillService>();
    activeAccountStatusMock$ = new BehaviorSubject(AuthenticationStatus.Unlocked);
    authService = mock<AuthService>();
    authService.activeAccountStatus$ = activeAccountStatusMock$;
    environmentMock$ = new BehaviorSubject(
      new CloudEnvironment({
        key: Region.US,
        domain: "bitwarden.com",
        urls: { icons: "https://icons.bitwarden.com/" },
      }),
    );
    environmentService = mock<EnvironmentService>();
    environmentService.environment$ = environmentMock$;
    inlineMenuVisibilityMock$ = new BehaviorSubject(AutofillOverlayVisibility.OnFieldFocus);
    autofillSettingsService = mock<AutofillSettingsService>();
    autofillSettingsService.inlineMenuVisibility$ = inlineMenuVisibilityMock$;
    i18nService = mock<I18nService>();
    platformUtilsService = mock<BrowserPlatformUtilsService>();
    selectedThemeMock$ = new BehaviorSubject(ThemeType.Light);
    themeStateService = mock<ThemeStateService>();
    themeStateService.selectedTheme$ = selectedThemeMock$;
    overlayBackground = new OverlayBackground(
      logService,
      cipherService,
      autofillService,
      authService,
      environmentService,
      domainSettingsService,
      autofillSettingsService,
      i18nService,
      platformUtilsService,
      themeStateService,
    );
    portKeyForTabSpy = overlayBackground["portKeyForTab"];
    pageDetailsForTabSpy = overlayBackground["pageDetailsForTab"];
    subFrameOffsetsSpy = overlayBackground["subFrameOffsetsForTab"];
    getFrameDetailsSpy = jest.spyOn(BrowserApi, "getFrameDetails");
    getFrameDetailsSpy.mockImplementation((_details: chrome.webNavigation.GetFrameDetails) => {
      getFrameCounter--;
      return mock<chrome.webNavigation.GetFrameResultDetails>({
        parentFrameId: getFrameCounter,
      });
    });
    tabsSendMessageSpy = jest.spyOn(BrowserApi, "tabSendMessage");
    sendMessageSpy = jest.spyOn(BrowserApi, "sendMessage");
    getTabFromCurrentWindowIdSpy = jest.spyOn(BrowserApi, "getTabFromCurrentWindowId");

    void overlayBackground.init();
  });

  afterEach(() => {
    getFrameCounter = 2;
    jest.clearAllMocks();
    jest.useRealTimers();
    mockReset(cipherService);
  });

  describe("storing pageDetails", () => {
    const tabId = 1;

    beforeEach(() => {
      sendMockExtensionMessage(
        { command: "collectPageDetailsResponse", details: createAutofillPageDetailsMock() },
        mock<chrome.runtime.MessageSender>({ tab: createChromeTabMock({ id: tabId }), frameId: 0 }),
      );
    });

    it("generates a random 12 character string used to validate port messages from the tab", () => {
      expect(portKeyForTabSpy[tabId]).toHaveLength(12);
    });

    it("stores the page details for the tab", () => {
      expect(pageDetailsForTabSpy[tabId]).toBeDefined();
    });

    describe("building sub frame offsets", () => {
      beforeEach(() => {
        tabsSendMessageSpy.mockResolvedValue(
          mock<SubFrameOffsetData>({
            left: getFrameCounter,
            top: getFrameCounter,
            url: "url",
          }),
        );
      });

      it("builds the offset values for a sub frame within the tab", async () => {
        sendMockExtensionMessage(
          { command: "collectPageDetailsResponse", details: createAutofillPageDetailsMock() },
          mock<chrome.runtime.MessageSender>({
            tab: createChromeTabMock({ id: tabId }),
            frameId: 1,
          }),
        );
        await flushPromises();

        expect(subFrameOffsetsSpy[tabId]).toStrictEqual(
          new Map([[1, { left: 4, top: 4, url: "url" }]]),
        );
        expect(pageDetailsForTabSpy[tabId].size).toBe(2);
      });

      it("skips building offset values for a previously calculated sub frame", async () => {
        getFrameCounter = 0;
        sendMockExtensionMessage(
          { command: "collectPageDetailsResponse", details: createAutofillPageDetailsMock() },
          mock<chrome.runtime.MessageSender>({
            tab: createChromeTabMock({ id: tabId }),
            frameId: 1,
          }),
        );
        await flushPromises();

        sendMockExtensionMessage(
          { command: "collectPageDetailsResponse", details: createAutofillPageDetailsMock() },
          mock<chrome.runtime.MessageSender>({
            tab: createChromeTabMock({ id: tabId }),
            frameId: 1,
          }),
        );
        await flushPromises();

        expect(getFrameDetailsSpy).toHaveBeenCalledTimes(1);
        expect(subFrameOffsetsSpy[tabId]).toStrictEqual(
          new Map([[1, { left: 0, top: 0, url: "url" }]]),
        );
      });

      it("will attempt to build the sub frame offsets by posting window messages if a set of offsets is not returned", async () => {
        const tab = createChromeTabMock({ id: tabId });
        const frameId = 1;
        tabsSendMessageSpy.mockResolvedValueOnce(null);
        sendMockExtensionMessage(
          { command: "collectPageDetailsResponse", details: createAutofillPageDetailsMock() },
          mock<chrome.runtime.MessageSender>({ tab, frameId }),
        );
        await flushPromises();

        expect(tabsSendMessageSpy).toHaveBeenCalledWith(
          tab,
          {
            command: "getSubFrameOffsetsFromWindowMessage",
            subFrameId: frameId,
          },
          { frameId },
        );
        expect(subFrameOffsetsSpy[tabId]).toStrictEqual(new Map([[frameId, null]]));
      });

      it("updates sub frame data that has been calculated using window messages", async () => {
        const tab = createChromeTabMock({ id: tabId });
        const frameId = 1;
        const subFrameData = mock<SubFrameOffsetData>({ frameId, left: 10, top: 10, url: "url" });
        tabsSendMessageSpy.mockResolvedValueOnce(null);
        subFrameOffsetsSpy[tabId] = new Map([[frameId, null]]);

        sendMockExtensionMessage(
          { command: "updateSubFrameData", subFrameData },
          mock<chrome.runtime.MessageSender>({ tab, frameId }),
        );
        await flushPromises();

        expect(subFrameOffsetsSpy[tabId]).toStrictEqual(new Map([[frameId, subFrameData]]));
      });
    });
  });

  describe("removing pageDetails", () => {
    it("removes the page details, sub frame details, and port key for a specific tab from the pageDetailsForTab object", () => {
      const tabId = 1;
      sendMockExtensionMessage(
        { command: "collectPageDetailsResponse", details: createAutofillPageDetailsMock() },
        mock<chrome.runtime.MessageSender>({ tab: createChromeTabMock({ id: tabId }), frameId: 1 }),
      );

      overlayBackground.removePageDetails(tabId);

      expect(pageDetailsForTabSpy[tabId]).toBeUndefined();
      expect(subFrameOffsetsSpy[tabId]).toBeUndefined();
      expect(portKeyForTabSpy[tabId]).toBeUndefined();
    });
  });

  describe("re-positioning the inline menu within sub frames", () => {
    const tabId = 1;
    const topFrameId = 0;
    const middleFrameId = 10;
    const bottomFrameId = 20;
    let tab: chrome.tabs.Tab;

    beforeEach(() => {
      tab = createChromeTabMock({ id: tabId });
      overlayBackground["focusedFieldData"] = mock<FocusedFieldData>({
        tabId,
        frameId: bottomFrameId,
      });
      subFrameOffsetsSpy[tabId] = new Map([
        [topFrameId, { left: 1, top: 1, url: "https://top-frame.com" }],
        [middleFrameId, { left: 2, top: 2, url: "https://middle-frame.com" }],
        [bottomFrameId, { left: 3, top: 3, url: "https://bottom-frame.com" }],
      ]);
      tabsSendMessageSpy.mockResolvedValue(
        mock<SubFrameOffsetData>({
          left: getFrameCounter,
          top: getFrameCounter,
          url: "url",
        }),
      );
    });

    describe("rebuildSubFrameOffsets", () => {
      it("skips rebuilding sub frame offsets if the sender contains the currently focused field", () => {
        const sender = mock<chrome.runtime.MessageSender>({ tab, frameId: bottomFrameId });

        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);

        expect(getFrameDetailsSpy).not.toHaveBeenCalled();
      });

      it("skips rebuilding sub frame offsets if the tab does not contain sub frames", () => {
        const sender = mock<chrome.runtime.MessageSender>({
          tab: createChromeTabMock({ id: 15 }),
          frameId: 0,
        });

        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);

        expect(getFrameDetailsSpy).not.toHaveBeenCalled();
      });

      it("rebuilds the sub frame offsets for a given tab", async () => {
        const sender = mock<chrome.runtime.MessageSender>({ tab, frameId: middleFrameId });

        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);
        await flushPromises();

        expect(getFrameDetailsSpy).toHaveBeenCalledWith({ tabId, frameId: topFrameId });
        expect(getFrameDetailsSpy).toHaveBeenCalledWith({ tabId, frameId: bottomFrameId });
        expect(getFrameDetailsSpy).not.toHaveBeenCalledWith({ tabId, frameId: middleFrameId });
      });

      it("triggers an update of the inline menu position after rebuilding sub frames", async () => {
        jest.useFakeTimers();
        overlayBackground["updateInlineMenuPositionTimeout"] = setTimeout(jest.fn, 650);
        const sender = mock<chrome.runtime.MessageSender>({ tab, frameId: middleFrameId });
        jest.spyOn(overlayBackground as any, "updateInlineMenuPositionAfterSubFrameRebuild");

        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);
        await flushPromises();
        jest.advanceTimersByTime(650);

        expect(
          overlayBackground["updateInlineMenuPositionAfterSubFrameRebuild"],
        ).toHaveBeenCalled();
      });
    });

    describe("updateInlineMenuPositionAfterSubFrameRebuild", () => {
      let sender: chrome.runtime.MessageSender;

      async function flushInlineMenuUpdatePromises() {
        await flushPromises();
        jest.advanceTimersByTime(650);
        await flushPromises();
      }

      beforeEach(() => {
        sender = mock<chrome.runtime.MessageSender>({ tab, frameId: middleFrameId });
        jest.useFakeTimers();
        sendMockExtensionMessage({
          command: "updateIsFieldCurrentlyFocused",
          isFieldCurrentlyFocused: true,
        });
      });

      it("skips updating the position of either inline menu element if a field is not currently focused", async () => {
        sendMockExtensionMessage({
          command: "updateIsFieldCurrentlyFocused",
          isFieldCurrentlyFocused: false,
        });

        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);
        await flushInlineMenuUpdatePromises();

        expect(tabsSendMessageSpy).not.toHaveBeenCalledWith(
          sender.tab,
          {
            command: "appendInlineMenuElementsToDom",
            overlayElement: AutofillOverlayElement.Button,
          },
          { frameId: 0 },
        );
        expect(tabsSendMessageSpy).not.toHaveBeenCalledWith(
          sender.tab,
          {
            command: "appendInlineMenuElementsToDom",
            overlayElement: AutofillOverlayElement.List,
          },
          { frameId: 0 },
        );
      });

      it("updates the position of the inline menu elements", async () => {
        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);
        await flushInlineMenuUpdatePromises();

        expect(tabsSendMessageSpy).toHaveBeenCalledWith(
          sender.tab,
          {
            command: "appendInlineMenuElementsToDom",
            overlayElement: AutofillOverlayElement.Button,
          },
          { frameId: 0 },
        );
        expect(tabsSendMessageSpy).toHaveBeenCalledWith(
          sender.tab,
          {
            command: "appendInlineMenuElementsToDom",
            overlayElement: AutofillOverlayElement.List,
          },
          { frameId: 0 },
        );
      });

      it("skips updating the inline menu list if the focused field has a value and the user status is not unlocked", async () => {
        activeAccountStatusMock$.next(AuthenticationStatus.Locked);
        tabsSendMessageSpy.mockImplementation((_tab, message, _options) => {
          if (message.command === "checkMostRecentlyFocusedFieldHasValue") {
            return Promise.resolve(true);
          }
          return Promise.resolve();
        });

        sendMockExtensionMessage({ command: "rebuildSubFrameOffsets" }, sender);
        await flushInlineMenuUpdatePromises();

        expect(tabsSendMessageSpy).toHaveBeenCalledWith(
          sender.tab,
          {
            command: "appendInlineMenuElementsToDom",
            overlayElement: AutofillOverlayElement.Button,
          },
          { frameId: 0 },
        );
        expect(tabsSendMessageSpy).not.toHaveBeenCalledWith(
          sender.tab,
          {
            command: "appendInlineMenuElementsToDom",
            overlayElement: AutofillOverlayElement.List,
          },
          { frameId: 0 },
        );
      });
    });
  });

  describe("updating the overlay ciphers", () => {
    const url = "https://jest-testing-website.com";
    const tab = createChromeTabMock({ url });
    const cipher1 = mock<CipherView>({
      id: "id-1",
      localData: { lastUsedDate: 222 },
      name: "name-1",
      type: CipherType.Login,
      login: { username: "username-1", uri: url },
    });
    const cipher2 = mock<CipherView>({
      id: "id-2",
      localData: { lastUsedDate: 222 },
      name: "name-2",
      type: CipherType.Card,
      card: { subTitle: "subtitle-2" },
    });

    beforeEach(() => {
      activeAccountStatusMock$.next(AuthenticationStatus.Unlocked);
    });

    it("skips updating the overlay ciphers if the user's auth status is not unlocked", async () => {
      activeAccountStatusMock$.next(AuthenticationStatus.Locked);

      await overlayBackground.updateOverlayCiphers();

      expect(getTabFromCurrentWindowIdSpy).not.toHaveBeenCalled();
      expect(cipherService.getAllDecryptedForUrl).not.toHaveBeenCalled();
    });

    it("ignores updating the overlay ciphers if the tab is undefined", async () => {
      getTabFromCurrentWindowIdSpy.mockResolvedValueOnce(undefined);

      await overlayBackground.updateOverlayCiphers();

      expect(getTabFromCurrentWindowIdSpy).toHaveBeenCalled();
      expect(cipherService.getAllDecryptedForUrl).not.toHaveBeenCalled();
    });

    it("queries all ciphers for the given url, sort them by last used, and format them for usage in the overlay", async () => {
      getTabFromCurrentWindowIdSpy.mockResolvedValueOnce(tab);
      cipherService.getAllDecryptedForUrl.mockResolvedValue([cipher1, cipher2]);
      cipherService.sortCiphersByLastUsedThenName.mockReturnValue(-1);

      await overlayBackground.updateOverlayCiphers();

      expect(BrowserApi.getTabFromCurrentWindowId).toHaveBeenCalled();
      expect(cipherService.getAllDecryptedForUrl).toHaveBeenCalledWith(url);
      expect(cipherService.sortCiphersByLastUsedThenName).toHaveBeenCalled();
      expect(overlayBackground["inlineMenuCiphers"]).toStrictEqual(
        new Map([
          ["overlay-cipher-0", cipher2],
          ["overlay-cipher-1", cipher1],
        ]),
      );
    });

    it("posts an `updateOverlayListCiphers` message to the overlay list port, and send a `updateIsOverlayCiphersPopulated` message to the tab indicating that the list of ciphers is populated", async () => {
      overlayBackground["inlineMenuListPort"] = mock<chrome.runtime.Port>();
      cipherService.getAllDecryptedForUrl.mockResolvedValue([cipher1, cipher2]);
      cipherService.sortCiphersByLastUsedThenName.mockReturnValue(-1);
      getTabFromCurrentWindowIdSpy.mockResolvedValueOnce(tab);

      await overlayBackground.updateOverlayCiphers();

      expect(overlayBackground["inlineMenuListPort"].postMessage).toHaveBeenCalledWith({
        command: "updateAutofillInlineMenuListCiphers",
        ciphers: [
          {
            card: cipher2.card.subTitle,
            favorite: cipher2.favorite,
            icon: {
              fallbackImage: "",
              icon: "bwi-credit-card",
              image: undefined,
              imageEnabled: true,
            },
            id: "overlay-cipher-0",
            login: null,
            name: "name-2",
            reprompt: cipher2.reprompt,
            type: 3,
          },
          {
            card: null,
            favorite: cipher1.favorite,
            icon: {
              fallbackImage: "images/bwi-globe.png",
              icon: "bwi-globe",
              image: "https://icons.bitwarden.com//jest-testing-website.com/icon.png",
              imageEnabled: true,
            },
            id: "overlay-cipher-1",
            login: {
              username: "username-1",
            },
            name: "name-1",
            reprompt: cipher1.reprompt,
            type: 1,
          },
        ],
      });
    });
  });

  describe("extension message handlers", () => {
    describe("autofillOverlayElementClosed message handler", () => {
      beforeEach(async () => {
        await initOverlayElementPorts();
      });

      it("disconnects any expired ports if the sender is not from the same page as the most recently focused field", () => {
        const port1 = mock<chrome.runtime.Port>();
        const port2 = mock<chrome.runtime.Port>();
        overlayBackground["expiredPorts"] = [port1, port2];
        const sender = mock<chrome.runtime.MessageSender>({ tab: { id: 1 } });
        const focusedFieldData = createFocusedFieldDataMock({ tabId: 2 });
        sendMockExtensionMessage({ command: "updateFocusedFieldData", focusedFieldData });

        sendMockExtensionMessage(
          {
            command: "autofillOverlayElementClosed",
            overlayElement: AutofillOverlayElement.Button,
          },
          sender,
        );

        expect(port1.disconnect).toHaveBeenCalled();
        expect(port2.disconnect).toHaveBeenCalled();
      });

      it("disconnects the button element port", () => {
        sendMockExtensionMessage({
          command: "autofillOverlayElementClosed",
          overlayElement: AutofillOverlayElement.Button,
        });

        expect(buttonPortSpy.disconnect).toHaveBeenCalled();
      });

      it("disconnects the list element port", () => {
        sendMockExtensionMessage({
          command: "autofillOverlayElementClosed",
          overlayElement: AutofillOverlayElement.List,
        });

        expect(listPortSpy.disconnect).toHaveBeenCalled();
      });
    });

    describe("autofillOverlayAddNewVaultItem message handler", () => {
      let sender: chrome.runtime.MessageSender;
      let openAddEditVaultItemPopoutSpy: jest.SpyInstance;

      beforeEach(() => {
        sender = mock<chrome.runtime.MessageSender>({ tab: { id: 1 } });
        openAddEditVaultItemPopoutSpy = jest
          .spyOn(overlayBackground as any, "openAddEditVaultItemPopout")
          .mockImplementation();
      });

      it("will not open the add edit popout window if the message does not have a login cipher provided", () => {
        sendMockExtensionMessage({ command: "autofillOverlayAddNewVaultItem" }, sender);

        expect(cipherService.setAddEditCipherInfo).not.toHaveBeenCalled();
        expect(openAddEditVaultItemPopoutSpy).not.toHaveBeenCalled();
      });

      it("will open the add edit popout window after creating a new cipher", async () => {
        sendMockExtensionMessage(
          {
            command: "autofillOverlayAddNewVaultItem",
            login: {
              uri: "https://tacos.com",
              hostname: "",
              username: "username",
              password: "password",
            },
          },
          sender,
        );
        await flushPromises();

        expect(cipherService.setAddEditCipherInfo).toHaveBeenCalled();
        expect(sendMessageSpy).toHaveBeenCalledWith("inlineAutofillMenuRefreshAddEditCipher");
        expect(openAddEditVaultItemPopoutSpy).toHaveBeenCalled();
      });
    });

    describe("checkIsInlineMenuCiphersPopulated message handler", () => {
      let focusedFieldData: FocusedFieldData;

      beforeEach(() => {
        focusedFieldData = createFocusedFieldDataMock();
        sendMockExtensionMessage(
          { command: "updateFocusedFieldData", focusedFieldData },
          mock<chrome.runtime.MessageSender>({ tab: { id: 2 }, frameId: 0 }),
        );
      });

      it("returns false if the sender's tab id is not equal to the focused field's tab id", async () => {
        const sender = mock<chrome.runtime.MessageSender>({ tab: { id: 1 } });

        sendMockExtensionMessage(
          { command: "checkIsInlineMenuCiphersPopulated" },
          sender,
          sendResponse,
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith(false);
      });

      it("returns false if the overlay login cipher are not populated", () => {});

      it("returns true if the overlay login ciphers are populated", async () => {
        overlayBackground["inlineMenuCiphers"] = new Map([
          ["overlay-cipher-0", mock<CipherView>()],
        ]);

        sendMockExtensionMessage(
          { command: "checkIsInlineMenuCiphersPopulated" },
          mock<chrome.runtime.MessageSender>({ tab: { id: 2 } }),
          sendResponse,
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith(true);
      });
    });

    describe("checkIsFieldCurrentlyFocused message handler", () => {
      it("returns true when a form field is currently focused", async () => {
        sendMockExtensionMessage({
          command: "updateIsFieldCurrentlyFocused",
          isFieldCurrentlyFocused: true,
        });

        sendMockExtensionMessage(
          { command: "checkIsFieldCurrentlyFocused" },
          mock<chrome.runtime.MessageSender>(),
          sendResponse,
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith(true);
      });
    });

    describe("checkIsFieldCurrentlyFilling message handler", () => {
      it("returns true if autofill is currently running", async () => {
        sendMockExtensionMessage({
          command: "updateIsFieldCurrentlyFilling",
          isFieldCurrentlyFilling: true,
        });

        sendMockExtensionMessage(
          { command: "checkIsFieldCurrentlyFilling" },
          mock<chrome.runtime.MessageSender>(),
          sendResponse,
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith(true);
      });
    });

    describe("getAutofillInlineMenuVisibility message handler", () => {
      it("returns the current inline menu visibility setting", async () => {
        sendMockExtensionMessage(
          { command: "getAutofillInlineMenuVisibility" },
          mock<chrome.runtime.MessageSender>(),
          sendResponse,
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith(AutofillOverlayVisibility.OnFieldFocus);
      });
    });

    describe("openAutofillInlineMenu", () => {
      let sender: chrome.runtime.MessageSender;

      beforeEach(() => {
        sender = mock<chrome.runtime.MessageSender>({ tab: { id: 1 } });
        getTabFromCurrentWindowIdSpy.mockResolvedValue(sender.tab);
        tabsSendMessageSpy.mockImplementation();
      });

      it("opens the autofill inline menu by sending a message to the current tab", async () => {
        sendMockExtensionMessage({ command: "openAutofillInlineMenu" }, sender);
        await flushPromises();

        expect(tabsSendMessageSpy).toHaveBeenCalledWith(
          sender.tab,
          {
            command: "openAutofillInlineMenu",
            isFocusingFieldElement: false,
            isOpeningFullAutofillInlineMenu: false,
            authStatus: 2,
          },
          { frameId: 0 },
        );
      });

      it("sends the open menu message to the focused field's frameId", async () => {
        sender.frameId = 10;
        sendMockExtensionMessage({ command: "updateFocusedFieldData" }, sender);
        await flushPromises();

        sendMockExtensionMessage({ command: "openAutofillInlineMenu" }, sender);
        await flushPromises();

        expect(tabsSendMessageSpy).toHaveBeenCalledWith(
          sender.tab,
          {
            command: "openAutofillInlineMenu",
            isFocusingFieldElement: false,
            isOpeningFullAutofillInlineMenu: false,
            authStatus: 2,
          },
          { frameId: 10 },
        );
      });
    });
  });

  describe("inline menu button message handlers", () => {});

  describe("inline menu list message handlers", () => {});
});
