"""Image-wide Python startup hook for the ChatHub sandbox image."""
import logging


class _FontWeightNoise(logging.Filter):
    # WenQuanYi Zen Hei ships only a Medium (500) face, so matplotlib logs a
    # weight fallback on every plot. Other font warnings stay visible.
    def filter(self, record):
        return "Failed to find font weight" not in record.getMessage()


logging.getLogger("matplotlib.font_manager").addFilter(_FontWeightNoise())
