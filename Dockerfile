FROM python:3.11-slim

ENV NODE_VERSION=20 \
    HF_HOME=/cache/huggingface \
    HF_HUB_CACHE=/cache/huggingface/hub \
    SENTENCE_TRANSFORMERS_HOME=/cache/huggingface/sentence-transformers \
    TRANSFORMERS_CACHE=/cache/huggingface/transformers \
    THALAMUS_ENCODER_BACKEND=fallback

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["npm", "run", "experiment:run"]
