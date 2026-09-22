import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css }) => ({
  // CSS rotation stays on the compositor while the message list re-renders.
  // SVG SMIL (`animateTransform`) freezes under that load and leaves the gray ring.
  arc: css`
    transform-origin: center;
    transform-box: view-box;
    animation: chat-send-stop-spin 1s linear infinite;

    @keyframes chat-send-stop-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
}));
