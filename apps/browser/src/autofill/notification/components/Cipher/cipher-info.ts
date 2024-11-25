import { css } from "@emotion/css";
import { html } from "lit";

import { Theme } from "@bitwarden/common/platform/enums";

import { themes, typography } from "../../constants/styles";
import { CipherData } from "../../types";

import { CipherInfoIndicatorIcons } from "./cipher-indicator-icons";

export function CipherInfo({ cipher, theme }: { cipher: CipherData; theme: Theme }) {
  const { name, login } = cipher;

  return html`
    <div>
      <span class=${cipherInfoPrimaryTextStyles(theme)}>
        ${[name, CipherInfoIndicatorIcons({ cipher, theme })]}
      </span>

      ${login.username
        ? html`<span class=${cipherInfoSecondaryTextStyles(theme)}>${login.username}</span>`
        : null}
    </div>
  `;
}

const cipherInfoPrimaryTextStyles = (theme: Theme) => css`
  ${typography.body2}

  gap: 2px;
  display: flex;
  display: block;
  overflow-x: hidden;
  text-overflow: ellipsis;
  color: ${themes[theme].text.main};
  font-weight: 500;
`;

const cipherInfoSecondaryTextStyles = (theme: Theme) => css`
  ${typography.helperMedium}

  display: block;
  overflow-x: hidden;
  text-overflow: ellipsis;
  color: ${themes[theme].text.muted};
  font-weight: 400;
`;
