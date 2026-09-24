FROM gotenberg/gotenberg:8

# Chinese fonts (Noto Sans/Serif CJK) so PDFs never render tofu.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
USER gotenberg
