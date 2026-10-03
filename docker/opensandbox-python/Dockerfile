# Sandbox image for ChatHub's OpenSandbox Code Interpreter provider.
# OpenSandbox injects execd; ChatHub only needs python3 on PATH plus the
# libraries runs may import. Build it on the host that runs the OpenSandbox
# server, then set OPENSANDBOX_IMAGE to the tag:
#   docker build -t chathub-sandbox-python:1 docker/opensandbox-python
FROM python:3.12-slim

# WenQuanYi Zen Hei has TrueType outlines, which reportlab's TTFont needs; it
# doubles as the STSong.ttf the Code Interpreter prompt asks for.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc /usr/share/fonts/truetype/STSong.ttf

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY matplotlibrc /etc/matplotlibrc
ENV MATPLOTLIBRC=/etc/matplotlibrc
COPY sitecustomize.py /tmp/sitecustomize.py
RUN mv /tmp/sitecustomize.py "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')/"

# Build the matplotlib font cache once instead of on every run.
RUN python3 -c "import matplotlib.pyplot"

WORKDIR /tmp
