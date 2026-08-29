import { Theme, css } from 'antd-style';
import { rgba } from 'polished';

export default ({ token }: { prefixCls: string; token: Theme }) => css`
  .${token.prefixCls}-popover {
    z-index: 1100;
  }

  .${token.prefixCls}-menu-sub.${token.prefixCls}-menu-vertical {
    border: 1px solid ${token.colorBorder};
    box-shadow: ${token.boxShadow};
  }

  .${token.prefixCls}-menu-item-selected {
    .${token.prefixCls}-menu-title-content {
      color: ${token.colorText};
    }
  }

  .${token.prefixCls}-modal-mask, .${token.prefixCls}-drawer-mask {
    background: ${rgba(token.colorBgLayout, 0.5)} !important;
    backdrop-filter: blur(2px);
  }

  /*
   * antd image-preview lightbox (used by the mermaid click-to-zoom). @lobehub/ui
   * hardcodes the preview mask to an opaque container color and opens at the
   * image's intrinsic size, so the backdrop looks like a flat panel and small
   * diagrams show tiny. Restore a translucent scrim and let the (vector) image
   * scale toward the viewport. Global to all antd previews — the scrim is
   * desirable everywhere; the size cap only enlarges, never distorts.
   */
  .${token.prefixCls}-image-preview-mask {
    background: ${rgba(token.colorBgLayout, 0.5)} !important;
  }

  .${token.prefixCls}-image-preview-img {
    max-width: 90vw;
    max-height: 90vh;
  }

  /*
   * Settings switches: only the control toggles — not the full row label.
   * Ant Design associates horizontal Form.Item labels with the switch input.
   */
  .${token.prefixCls}-form-item:has(.${token.prefixCls}-switch)
    .${token.prefixCls}-form-item-label
    > label {
    cursor: default;
    pointer-events: none;
  }

  .${token.prefixCls}-form-item:has(.${token.prefixCls}-switch)
    .${token.prefixCls}-form-item-label
    .${token.prefixCls}-form-item-tooltip,
  .${token.prefixCls}-form-item:has(.${token.prefixCls}-switch)
    .${token.prefixCls}-form-item-label
    .chathub-form-label-tooltip {
    cursor: help;
    pointer-events: auto;
  }
`;
