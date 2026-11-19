# End-to-end tests: Playwright against the real Jot container.
FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN chmod -R a+rX /e2e && mkdir -p /e2e/test-results && chmod 777 /e2e /e2e/test-results
ENV HOME=/tmp
CMD ["npx", "playwright", "test"]
